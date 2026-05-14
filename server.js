const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const { randomUUID } = require("crypto");
const http = require("http");
const WebSocket = require("ws");

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const ROOT = __dirname;
const MEDIA_DIR = path.join(ROOT, "media");
const OUTPUT_DIR = path.join(ROOT, "outputs");
const PUBLIC_DIR = path.join(ROOT, "public");
const LYRICS_DIR = path.join(ROOT, "lyrics");
const ARTWORK_DIR = path.join(ROOT, "artwork");

for (const dir of [MEDIA_DIR, OUTPUT_DIR, PUBLIC_DIR, LYRICS_DIR, ARTWORK_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

const upload = multer({
  storage: multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, MEDIA_DIR),
    filename: (_req, file, cb) => {
      const safe = file.originalname.replace(/[^\w.\-() ]+/g, "_");
      cb(null, `${Date.now()}-${safe}`);
    }
  })
});

const jobs = new Map();

app.use(express.json({ limit: "2mb" }));
app.use(express.static(PUBLIC_DIR));
app.use("/media", express.static(MEDIA_DIR));
app.use("/outputs", express.static(OUTPUT_DIR));
app.use("/artwork", express.static(ARTWORK_DIR));

app.get("/api/status", async (_req, res) => {
  const ffmpeg = await runCapture("ffmpeg", ["-version"]);
  const ffprobe = await runCapture("ffprobe", ["-version"]);
  res.json({
    ffmpeg: ffmpeg.ok ? firstLine(ffmpeg.out) : null,
    ffprobe: ffprobe.ok ? firstLine(ffprobe.out) : null,
    mediaDir: MEDIA_DIR,
    outputDir: OUTPUT_DIR
  });
});

app.get("/api/files", (_req, res) => {
  res.json({
    media: listFiles(MEDIA_DIR, "/media"),
    outputs: listFiles(OUTPUT_DIR, "/outputs")
  });
});

app.delete("/api/files/:kind/:name", (req, res) => {
  try {
    const dir = req.params.kind === "media" ? MEDIA_DIR : req.params.kind === "outputs" ? OUTPUT_DIR : null;
    if (!dir) return res.status(400).json({ error: "Unknown file area." });

    const filePath = safeChildPath(dir, req.params.name);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: "File not found." });

    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return res.status(400).json({ error: "Only files can be deleted." });

    fs.unlinkSync(filePath);
    res.json({
      ok: true,
      files: {
        media: listFiles(MEDIA_DIR, "/media"),
        outputs: listFiles(OUTPUT_DIR, "/outputs")
      }
    });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/upload", upload.array("files", 20), (req, res) => {
  res.json({ files: req.files.map(fileInfo) });
});

app.post("/api/probe", async (req, res) => {
  const input = normalizeInput(req.body.input);
  if (!input) return res.status(400).json({ error: "Choose an input file first." });

  const result = await runCapture("ffprobe", [
    "-v", "error",
    "-print_format", "json",
    "-show_format",
    "-show_streams",
    input
  ]);

  if (!result.ok) return res.status(500).json({ error: result.out });
  res.json(JSON.parse(result.out));
});

app.post("/api/artwork", async (req, res) => {
  const input = normalizeInput(req.body.input);
  if (!input) return res.status(400).json({ error: "Choose an input file first." });

  const key = `${safeFilePart(path.basename(input))}-${fs.statSync(input).mtimeMs.toFixed(0)}.jpg`;
  const output = path.join(ARTWORK_DIR, key);
  if (fs.existsSync(output)) return res.json({ found: true, url: `/artwork/${encodeURIComponent(key)}`, path: output });

  const result = await runCapture("ffmpeg", [
    "-y",
    "-i", input,
    "-an",
    "-vcodec", "mjpeg",
    "-frames:v", "1",
    output
  ]);

  if (result.ok && fs.existsSync(output) && fs.statSync(output).size > 0) {
    return res.json({ found: true, url: `/artwork/${encodeURIComponent(key)}`, path: output });
  }

  if (fs.existsSync(output)) fs.unlinkSync(output);
  res.json({ found: false });
});

app.post("/api/lyrics", async (req, res) => {
  const input = normalizeInput(req.body.input);
  if (!input) return res.status(400).json({ error: "Choose an input file first." });

  const result = await runCapture("ffprobe", [
    "-v", "error",
    "-print_format", "json",
    "-show_format",
    "-show_streams",
    input
  ]);

  if (!result.ok) return res.status(500).json({ error: result.out });

  const probe = JSON.parse(result.out);
  const tags = probe.format?.tags || {};
  const lyrics = extractLyrics(probe);
  const trackInfo = getTrackInfo(input, probe);

  if (!lyrics.text && req.body.online !== false) {
    const online = await fetchOnlineLyrics(trackInfo);
    if (online.text) {
      const cacheName = `${safeFilePart(trackInfo.artist || "unknown")} - ${safeFilePart(trackInfo.title || path.parse(input).name)}.${online.synced ? "lrc" : "txt"}`;
      const cacheFile = path.join(LYRICS_DIR, cacheName);
      fs.writeFileSync(cacheFile, online.text);
      return res.json({
        found: true,
        lyrics: online.text,
        synced: online.synced,
        source: online.source,
        provider: "LRCLIB",
        cachedFile: cacheFile,
        title: trackInfo.title,
        artist: trackInfo.artist
      });
    }
  }

  res.json({
    found: Boolean(lyrics.text),
    lyrics: lyrics.text,
    synced: looksLikeLrc(lyrics.text),
    source: lyrics.source,
    provider: lyrics.text ? "embedded" : "",
    title: trackInfo.title || tags.title || "",
    artist: trackInfo.artist || tags.artist || tags.album_artist || ""
  });
});

app.post("/api/run", (req, res) => {
  try {
    const job = createJob(req.body || {});
    jobs.set(job.id, job);
    runJob(job);
    res.json({ id: job.id, command: renderCommand(job.command, job.args), outputUrl: outputUrl(job.output) });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

app.post("/api/jobs/:id/stop", (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job || !job.process) return res.status(404).json({ error: "Job not found." });
  job.process.kill("SIGTERM");
  res.json({ ok: true });
});

wss.on("connection", socket => {
  socket.send(JSON.stringify({ type: "hello", jobs: publicJobs() }));
});

function createJob(body) {
  const mode = body.mode || "convert";
  const input = normalizeInput(body.input);
  const output = normalizeOutput(body.output || defaultOutput(body, mode));
  const overwrite = body.overwrite !== false;
  const audioOnlyInput = body.mediaType === "audio";
  const args = [];

  if (overwrite) args.push("-y");

  if (mode === "advanced") {
    const advancedArgs = splitArgs(body.args || "");
    if (!advancedArgs.length) throw new Error("Enter FFmpeg arguments for advanced mode.");
    return makeJob("ffmpeg", advancedArgs, body.output ? output : null, mode);
  }

  if (mode === "merge") {
    const mergeJobArgs = overwrite ? ["-y"] : [];
    mergeJobArgs.push(...mergeArgs(body));
    return makeJob("ffmpeg", mergeJobArgs, mergeJobArgs.at(-1), mode);
  }

  if (!input) throw new Error("Choose or upload an input file first.");
  args.push(...inputArgs(body), "-i", input);

  switch (mode) {
    case "convert":
      if (audioOnlyInput) args.push("-vn");
      args.push(...convertArgs(body));
      break;
    case "trim":
      if (audioOnlyInput) args.push("-vn");
      args.push(...trimArgs(body), ...convertArgs(body));
      break;
    case "audio":
      args.push(...audioArgs(body));
      break;
    case "video":
      args.push(...videoArgs(body));
      break;
    case "gif":
      args.push(...trimArgs(body), "-vf", gifFilter(body), "-loop", String(body.loop ?? 0));
      break;
    case "extract-audio":
      args.push("-vn", "-c:a", body.audioCodec || "mp3");
      break;
    case "frames":
      args.push(...trimArgs(body), "-vf", `fps=${body.fps || 1}`);
      break;
    case "subtitles":
      args.push(...subtitleArgs(body));
      break;
    default:
      throw new Error(`Unknown mode: ${mode}`);
  }

  if (body.extraArgs) args.push(...splitArgs(body.extraArgs));
  args.push(output);
  return makeJob("ffmpeg", args, output, mode);
}

function inputArgs(body) {
  const args = [];
  if (body.hwaccel && body.hwaccel !== "none") args.push("-hwaccel", body.hwaccel);
  if (body.realtime) args.push("-re");
  return args;
}

function convertArgs(body) {
  const args = [];
  if (body.mediaType !== "audio" && body.videoCodec) args.push("-c:v", body.videoCodec);
  if (body.audioCodec) args.push("-c:a", body.audioCodec);
  if (body.crf) args.push("-crf", String(body.crf));
  if (body.preset) args.push("-preset", body.preset);
  if (body.videoBitrate) args.push("-b:v", body.videoBitrate);
  const audioBitrate = body.audioBitrate || body.originalAudioBitrate || (body.audioCodec === "mp3" ? "320k" : "");
  if (audioBitrate && body.audioCodec !== "copy") args.push("-b:a", audioBitrate);
  if (body.format) args.push("-f", body.format);
  return args;
}

function trimArgs(body) {
  const args = [];
  if (body.start) args.push("-ss", body.start);
  if (body.duration) args.push("-t", body.duration);
  if (body.to) args.push("-to", body.to);
  return args;
}

function audioArgs(body) {
  const filters = [];
  const args = ["-vn"];
  if (body.volume) filters.push(`volume=${body.volume}`);
  if (body.bassGain) filters.push(`bass=g=${body.bassGain}`);
  if (body.trebleGain) filters.push(`treble=g=${body.trebleGain}`);
  if (body.audioFilter) filters.push(body.audioFilter);
  if (body.fadeIn) filters.push(`afade=t=in:st=0:d=${body.fadeIn}`);
  if (body.fadeOut && body.fadeOutStart) filters.push(`afade=t=out:st=${body.fadeOutStart}:d=${body.fadeOut}`);
  if (body.sampleRate) args.push("-ar", String(body.sampleRate));
  if (body.channels) args.push("-ac", String(body.channels));
  if (filters.length) args.push("-af", filters.join(","));
  args.push("-c:a", body.audioCodec || "aac");
  const audioBitrate = body.audioBitrate || body.originalAudioBitrate || (body.audioCodec === "mp3" ? "320k" : "");
  if (audioBitrate && body.audioCodec !== "copy") args.push("-b:a", audioBitrate);
  return args;
}

function videoArgs(body) {
  const filters = [];
  const args = ["-an"];
  if (body.scale) filters.push(`scale=${body.scale}`);
  if (body.crop) filters.push(`crop=${body.crop}`);
  if (body.rotate) filters.push(`transpose=${body.rotate}`);
  if (body.fps) filters.push(`fps=${body.fps}`);
  if (body.filter) filters.push(body.filter);
  if (filters.length) args.push("-vf", filters.join(","));
  args.push("-c:v", body.videoCodec || "libx264");
  if (body.crf) args.push("-crf", String(body.crf));
  if (body.preset) args.push("-preset", body.preset);
  return args;
}

function gifFilter(body) {
  const fps = body.fps || 12;
  const width = body.width || 640;
  return `fps=${fps},scale=${width}:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse`;
}

function subtitleArgs(body) {
  if (!body.subtitle) throw new Error("Choose a subtitle file path for subtitle mode.");
  if (body.burnSubtitles) {
    return ["-vf", `subtitles=${escapeFilterPath(normalizeInput(body.subtitle) || body.subtitle)}`, ...convertArgs(body)];
  }
  return ["-i", normalizeInput(body.subtitle) || body.subtitle, "-c", "copy", "-c:s", body.subtitleCodec || "mov_text"];
}

function mergeArgs(body) {
  const inputs = Array.isArray(body.inputs) ? body.inputs.map(normalizeInput).filter(Boolean) : [];
  if (inputs.length < 2) throw new Error("Merge needs at least two input files.");
  const listPath = path.join(MEDIA_DIR, `concat-${Date.now()}.txt`);
  fs.writeFileSync(listPath, inputs.map(file => `file '${file.replace(/'/g, "'\\''")}'`).join("\n"));
  const output = normalizeOutput(body.output || `merged-${Date.now()}.mp4`);
  return ["-f", "concat", "-safe", "0", "-i", listPath, "-c", body.copy === false ? "libx264" : "copy", output];
}

function makeJob(command, args, output, mode) {
  return {
    id: randomUUID(),
    command,
    args,
    output,
    mode,
    status: "queued",
    log: "",
    createdAt: new Date().toISOString()
  };
}

function runJob(job) {
  job.status = "running";
  broadcast({ type: "job", job: publicJob(job) });
  job.process = spawn(job.command, job.args, { windowsHide: true });

  job.process.stdout.on("data", chunk => appendLog(job, chunk));
  job.process.stderr.on("data", chunk => appendLog(job, chunk));
  job.process.on("error", error => {
    job.status = "failed";
    appendLog(job, `\n${error.message}\n`);
    broadcast({ type: "job", job: publicJob(job) });
  });
  job.process.on("close", code => {
    job.status = code === 0 ? "done" : "failed";
    job.exitCode = code;
    job.finishedAt = new Date().toISOString();
    broadcast({ type: "job", job: publicJob(job) });
    broadcast({ type: "files", files: { media: listFiles(MEDIA_DIR, "/media"), outputs: listFiles(OUTPUT_DIR, "/outputs") } });
  });
}

function appendLog(job, chunk) {
  job.log += chunk.toString();
  if (job.log.length > 120000) job.log = job.log.slice(-120000);
  broadcast({ type: "log", id: job.id, chunk: chunk.toString(), status: job.status });
}

function broadcast(payload) {
  const data = JSON.stringify(payload);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(data);
  }
}

function normalizeInput(value) {
  if (!value) return "";
  if (path.isAbsolute(value)) return value;
  const clean = value.replace(/^[/\\]*(media|outputs)[/\\]/, "");
  for (const dir of [MEDIA_DIR, OUTPUT_DIR]) {
    const candidate = path.join(dir, clean);
    if (fs.existsSync(candidate)) return candidate;
  }
  return value;
}

function normalizeOutput(value) {
  const clean = String(value || "").trim();
  if (!clean) throw new Error("Output filename is required.");
  if (path.isAbsolute(clean)) return clean;
  return path.join(OUTPUT_DIR, clean.replace(/[<>:"|?*]+/g, "_"));
}

function defaultOutput(body, mode) {
  const extByMode = {
    audio: "m4a",
    "extract-audio": "mp3",
    gif: "gif",
    frames: "jpg"
  };
  if ((mode === "trim" || mode === "convert") && body.mediaType === "audio") {
    return `${mode}-${Date.now()}.mp3`;
  }
  const ext = body.extension || extByMode[mode] || "mp4";
  return `${mode}-${Date.now()}.${ext}`;
}

function splitArgs(input) {
  const args = [];
  const regex = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|(\S+)/g;
  let match;
  while ((match = regex.exec(input))) {
    args.push((match[1] ?? match[2] ?? match[3]).replace(/\\"/g, "\""));
  }
  return args;
}

function escapeFilterPath(filePath) {
  return filePath.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

function listFiles(dir, prefix) {
  return fs.readdirSync(dir)
    .filter(name => name !== ".gitkeep")
    .map(name => {
      const full = path.join(dir, name);
      const stat = fs.statSync(full);
      return { name, path: full, url: `${prefix}/${encodeURIComponent(name)}`, size: stat.size, modified: stat.mtime };
    })
    .sort((a, b) => new Date(b.modified) - new Date(a.modified));
}

function safeChildPath(parent, name) {
  const decodedName = path.basename(decodeURIComponent(name || ""));
  if (!decodedName) throw new Error("Filename is required.");

  const resolvedParent = path.resolve(parent);
  const resolvedFile = path.resolve(resolvedParent, decodedName);
  if (!resolvedFile.startsWith(`${resolvedParent}${path.sep}`)) {
    throw new Error("Invalid file path.");
  }
  return resolvedFile;
}

function fileInfo(file) {
  return {
    name: file.filename,
    originalName: file.originalname,
    path: file.path,
    url: `/media/${encodeURIComponent(file.filename)}`,
    size: file.size
  };
}

function outputUrl(filePath) {
  if (!filePath || !filePath.startsWith(OUTPUT_DIR)) return null;
  return `/outputs/${encodeURIComponent(path.basename(filePath))}`;
}

function publicJob(job) {
  return {
    id: job.id,
    mode: job.mode,
    status: job.status,
    command: renderCommand(job.command, job.args),
    outputUrl: outputUrl(job.output),
    exitCode: job.exitCode,
    createdAt: job.createdAt,
    finishedAt: job.finishedAt
  };
}

function publicJobs() {
  return Array.from(jobs.values()).map(publicJob).reverse();
}

function renderCommand(command, args) {
  return [command, ...args.map(arg => /\s/.test(arg) ? `"${arg}"` : arg)].join(" ");
}

function firstLine(text) {
  return text.split(/\r?\n/)[0];
}

function runCapture(command, args) {
  return new Promise(resolve => {
    const proc = spawn(command, args, { windowsHide: true });
    let out = "";
    proc.stdout.on("data", chunk => out += chunk.toString());
    proc.stderr.on("data", chunk => out += chunk.toString());
    proc.on("error", error => resolve({ ok: false, out: error.message }));
    proc.on("close", code => resolve({ ok: code === 0, out }));
  });
}

function extractLyrics(probe) {
  const lyricKeys = [
    "lyrics",
    "lyric",
    "unsyncedlyrics",
    "unsynchronised lyrics",
    "syncedlyrics",
    "synchronizedlyrics",
    "uslt",
    "sylt",
    "description"
  ];
  const tagGroups = [
    probe.format?.tags,
    ...(probe.streams || []).map(stream => stream.tags)
  ].filter(Boolean);

  for (const tags of tagGroups) {
    for (const [key, value] of Object.entries(tags)) {
      if (lyricKeys.includes(key.toLowerCase()) && String(value).trim()) {
        return { text: String(value).trim(), source: key };
      }
    }
  }

  return { text: "", source: "" };
}

function getTrackInfo(input, probe) {
  const tags = probe.format?.tags || {};
  const parsedName = parseArtistTitle(path.parse(input).name.replace(/^\d+-/, ""));
  const duration = Number(probe.format?.duration || 0);
  return {
    title: tags.title || parsedName.title || "",
    artist: tags.artist || tags.album_artist || parsedName.artist || "",
    album: tags.album || "",
    duration: Number.isFinite(duration) ? Math.round(duration) : undefined
  };
}

function parseArtistTitle(name) {
  const match = name.match(/^(.+?)\s+-\s+(.+)$/);
  if (!match) return { artist: "", title: name };
  return { artist: match[1].trim(), title: match[2].trim() };
}

async function fetchOnlineLyrics(trackInfo) {
  if (!trackInfo.title || !trackInfo.artist) return { text: "", synced: false, source: "" };

  const params = new URLSearchParams({
    track_name: trackInfo.title,
    artist_name: trackInfo.artist
  });
  if (trackInfo.album) params.set("album_name", trackInfo.album);
  if (trackInfo.duration) params.set("duration", String(trackInfo.duration));

  try {
    const response = await fetch(`https://lrclib.net/api/get?${params}`, {
      headers: {
        "User-Agent": "AudioVideoEdit/1.0 (local personal media editor)"
      }
    });
    if (response.ok) {
      const data = await response.json();
      const found = lyricsFromLrclibData(data);
      if (found.text) return found;
    }

    params.delete("duration");
    params.delete("album_name");
    const searchResponse = await fetch(`https://lrclib.net/api/search?${params}`, {
      headers: {
        "User-Agent": "AudioVideoEdit/1.0 (local personal media editor)"
      }
    });
    if (!searchResponse.ok) return { text: "", synced: false, source: "" };

    const results = await searchResponse.json();
    const best = Array.isArray(results)
      ? results.find(item => item.syncedLyrics) || results.find(item => item.plainLyrics)
      : null;
    if (best) return lyricsFromLrclibData(best);
  } catch (_error) {
    return { text: "", synced: false, source: "" };
  }

  return { text: "", synced: false, source: "" };
}

function lyricsFromLrclibData(data) {
  if (typeof data?.syncedLyrics === "string" && data.syncedLyrics.trim()) {
    return { text: data.syncedLyrics, synced: true, source: "syncedLyrics" };
  }
  if (typeof data?.plainLyrics === "string" && data.plainLyrics.trim()) {
    return { text: data.plainLyrics, synced: false, source: "plainLyrics" };
  }
  return { text: "", synced: false, source: "" };
}

function looksLikeLrc(text) {
  return /\[\d{1,2}:\d{2}(?:\.\d{1,3})?\]/.test(text || "");
}

function safeFilePart(value) {
  return String(value).replace(/[<>:"/\\|?*]+/g, "_").trim().slice(0, 80) || "unknown";
}

const PORT = process.env.PORT || 5173;
server.listen(PORT, () => {
  console.log(`Audio Video Edit is running at http://localhost:${PORT}`);
});
