const modes = {
  convert: {
    label: "Convert",
    description: "Change containers, codecs, bitrate, CRF, presets, and formats.",
    fields: ["input", "output", "videoCodec", "audioCodec", "crf", "preset", "videoBitrate", "audioBitrate", "format", "extraArgs"]
  },
  trim: {
    label: "Trim",
    description: "Cut clips by start time, duration, or end time.",
    fields: ["input", "output", "start", "duration", "to", "videoCodec", "audioCodec", "crf", "preset", "extraArgs"]
  },
  audio: {
    label: "Audio",
    description: "Extract, change volume, EQ bass/treble, fade, resample, and encode audio.",
    fields: ["input", "output", "audioCodec", "audioBitrate", "volume", "bassGain", "trebleGain", "audioFilter", "fadeIn", "fadeOutStart", "fadeOut", "sampleRate", "channels", "extraArgs"]
  },
  video: {
    label: "Video",
    description: "Scale, crop, rotate, change FPS, filter, and encode video-only outputs.",
    fields: ["input", "output", "videoCodec", "crf", "preset", "scale", "crop", "rotate", "fps", "filter", "extraArgs"]
  },
  "extract-audio": {
    label: "Extract Audio",
    description: "Pull the audio stream from a video into MP3, AAC, WAV, FLAC, or Opus.",
    fields: ["input", "output", "audioCodec", "audioBitrate", "extraArgs"]
  },
  gif: {
    label: "GIF",
    description: "Create palette-optimized GIFs from video clips.",
    fields: ["input", "output", "start", "duration", "fps", "width", "loop", "extraArgs"]
  },
  frames: {
    label: "Frames",
    description: "Export video frames as an image sequence.",
    fields: ["input", "output", "start", "duration", "fps", "extraArgs"]
  },
  subtitles: {
    label: "Subtitles",
    description: "Burn subtitles into video or attach subtitle tracks.",
    fields: ["input", "subtitle", "output", "burnSubtitles", "subtitleCodec", "videoCodec", "audioCodec", "crf", "preset", "extraArgs"]
  },
  merge: {
    label: "Merge",
    description: "Concatenate compatible clips using FFmpeg concat mode.",
    fields: ["inputs", "output", "copy"]
  },
  probe: {
    label: "Inspect",
    description: "Read stream, codec, duration, bitrate, and metadata details with FFprobe.",
    fields: ["input"]
  },
  advanced: {
    label: "Advanced",
    description: "Run any FFmpeg argument list directly. Use full paths or uploaded file paths.",
    fields: ["args"]
  }
};

const fieldDefs = {
  input: { label: "Input", type: "selectFile" },
  inputs: { label: "Input files", type: "multiFile" },
  subtitle: { label: "Subtitle file", type: "text", placeholder: "D:\\path\\captions.srt or uploaded file path" },
  output: { label: "Output filename or full path", type: "text", placeholder: "output.mp4" },
  videoCodec: { label: "Video codec", type: "select", options: ["libx264", "libx265", "h264_nvenc", "hevc_nvenc", "libvpx-vp9", "copy", "none"] },
  audioCodec: { label: "Audio codec", type: "select", options: ["aac", "mp3", "libopus", "flac", "pcm_s16le", "copy", "none"] },
  crf: { label: "CRF", type: "number", placeholder: "23" },
  preset: { label: "Preset", type: "select", options: ["medium", "slow", "fast", "faster", "veryfast", "veryslow"] },
  videoBitrate: { label: "Video bitrate", type: "text", placeholder: "3500k" },
  audioBitrate: { label: "Audio bitrate", type: "text", placeholder: "192k" },
  format: { label: "Force format", type: "text", placeholder: "mp4, mp3, matroska" },
  start: { label: "Start", type: "text", placeholder: "00:00:05" },
  duration: { label: "Duration", type: "text", placeholder: "00:00:20" },
  to: { label: "End time", type: "text", placeholder: "00:01:10" },
  volume: { label: "Volume", type: "text", placeholder: "1.25 or -3dB" },
  bassGain: { label: "Bass gain dB", type: "number", placeholder: "6" },
  trebleGain: { label: "Treble gain dB", type: "number", placeholder: "4" },
  audioFilter: { label: "Custom audio filter", type: "text", placeholder: "equalizer=f=1000:t=q:w=1:g=3" },
  fadeIn: { label: "Fade in seconds", type: "number", placeholder: "2" },
  fadeOutStart: { label: "Fade out start", type: "text", placeholder: "58" },
  fadeOut: { label: "Fade out seconds", type: "number", placeholder: "2" },
  sampleRate: { label: "Sample rate", type: "number", placeholder: "48000" },
  channels: { label: "Channels", type: "number", placeholder: "2" },
  scale: { label: "Scale", type: "text", placeholder: "1280:-2" },
  crop: { label: "Crop", type: "text", placeholder: "1280:720:0:0" },
  rotate: { label: "Rotate", type: "select", options: ["", "1", "2", "3"] },
  fps: { label: "FPS", type: "number", placeholder: "30" },
  width: { label: "GIF width", type: "number", placeholder: "640" },
  loop: { label: "Loop", type: "number", placeholder: "0" },
  filter: { label: "Video filter", type: "text", placeholder: "eq=contrast=1.1:saturation=1.2" },
  burnSubtitles: { label: "Burn subtitles", type: "checkbox" },
  subtitleCodec: { label: "Subtitle codec", type: "select", options: ["mov_text", "srt", "ass", "copy"] },
  copy: { label: "Stream copy", type: "checkbox", checked: true },
  extraArgs: { label: "Extra FFmpeg args", type: "textarea", placeholder: "-movflags +faststart" },
  args: { label: "Full FFmpeg args", type: "textarea", full: true, placeholder: '-y -i "D:\\input.mp4" -c:v libx264 "D:\\output.mp4"' }
};

let currentMode = "convert";
let files = { media: [], outputs: [] };
let activeJob = null;
let selectedPreviewPath = "";
let trimStart = 0;
let trimEnd = 0;
let activeHandle = null;
let audioContext = null;
let mediaSourceNode = null;
let bassFilter = null;
let trebleFilter = null;
let previewGain = null;

const nav = document.querySelector("#modeNav");
const form = document.querySelector("#toolForm");
const runBtn = document.querySelector("#runBtn");
const stopBtn = document.querySelector("#stopBtn");
const refreshBtn = document.querySelector("#refreshBtn");
const commandPreview = document.querySelector("#commandPreview");
const log = document.querySelector("#log");
const mediaPlayer = document.querySelector("#mediaPlayer");
const previewName = document.querySelector("#previewName");
const currentTime = document.querySelector("#currentTime");
const durationTime = document.querySelector("#durationTime");
const startMarkBtn = document.querySelector("#startMarkBtn");
const endMarkBtn = document.querySelector("#endMarkBtn");
const backBtn = document.querySelector("#backBtn");
const forwardBtn = document.querySelector("#forwardBtn");
const trimTimeline = document.querySelector("#trimTimeline");
const timelineTrack = trimTimeline.querySelector(".timelineTrack");
const timelineSelection = document.querySelector("#timelineSelection");
const startHandle = document.querySelector("#startHandle");
const endHandle = document.querySelector("#endHandle");
const playhead = document.querySelector("#playhead");
const trimStartLabel = document.querySelector("#trimStartLabel");
const trimEndLabel = document.querySelector("#trimEndLabel");
const liveVolume = document.querySelector("#liveVolume");
const liveBass = document.querySelector("#liveBass");
const liveTreble = document.querySelector("#liveTreble");
const liveVolumeValue = document.querySelector("#liveVolumeValue");
const liveBassValue = document.querySelector("#liveBassValue");
const liveTrebleValue = document.querySelector("#liveTrebleValue");

for (const [key, mode] of Object.entries(modes)) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = mode.label;
  button.addEventListener("click", () => setMode(key));
  nav.appendChild(button);
}

setMode(currentMode);
loadStatus();
loadFiles();
connectSocket();

refreshBtn.addEventListener("click", loadFiles);
runBtn.addEventListener("click", run);
stopBtn.addEventListener("click", stopJob);
form.addEventListener("input", () => {
  preview();
  updatePreviewFromForm();
});
form.addEventListener("change", () => {
  preview();
  updatePreviewFromForm();
});
mediaPlayer.addEventListener("timeupdate", updatePlayerTime);
mediaPlayer.addEventListener("loadedmetadata", () => {
  trimStart = 0;
  trimEnd = Number.isFinite(mediaPlayer.duration) ? mediaPlayer.duration : 0;
  updatePlayerTime();
  syncTrimUi();
});
startMarkBtn.addEventListener("click", () => markCutPoint("start"));
endMarkBtn.addEventListener("click", () => markCutPoint("end"));
backBtn.addEventListener("click", () => seekBy(-1));
forwardBtn.addEventListener("click", () => seekBy(1));
timelineTrack.addEventListener("pointerdown", event => {
  if (event.target === startHandle || event.target === endHandle) return;
  seekTimeline(event);
});
startHandle.addEventListener("pointerdown", event => startDrag(event, "start"));
endHandle.addEventListener("pointerdown", event => startDrag(event, "end"));
window.addEventListener("pointermove", dragHandle);
window.addEventListener("pointerup", stopDrag);
mediaPlayer.addEventListener("play", initPreviewAudio);
liveVolume.addEventListener("input", updateLiveAudio);
liveBass.addEventListener("input", updateLiveAudio);
liveTreble.addEventListener("input", updateLiveAudio);

const dropzone = document.querySelector("#dropzone");
const fileInput = document.querySelector("#fileInput");
dropzone.addEventListener("dragover", event => {
  event.preventDefault();
  dropzone.classList.add("drag");
});
dropzone.addEventListener("dragleave", () => dropzone.classList.remove("drag"));
dropzone.addEventListener("drop", event => {
  event.preventDefault();
  dropzone.classList.remove("drag");
  uploadFiles(event.dataTransfer.files);
});
fileInput.addEventListener("change", () => uploadFiles(fileInput.files));

function setMode(mode) {
  currentMode = mode;
  document.querySelectorAll("nav button").forEach((button, index) => {
    button.classList.toggle("active", Object.keys(modes)[index] === mode);
  });
  document.querySelector("#modeTitle").textContent = modes[mode].label;
  document.querySelector("#modeDescription").textContent = modes[mode].description;
  renderForm();
  preview();
}

function renderForm() {
  const previous = collect();
  form.innerHTML = "";
  const grid = document.createElement("div");
  grid.className = "grid";
  for (const key of modes[currentMode].fields) {
    grid.appendChild(renderField(key, fieldDefs[key], previous[key]));
  }
  form.appendChild(grid);
  syncLiveAudioToForm();
}

function renderField(key, def, value) {
  const wrap = document.createElement("div");
  wrap.className = `field ${def.full || def.type === "textarea" || def.type === "multiFile" ? "full" : ""}`;
  const label = document.createElement("label");
  label.htmlFor = key;
  label.textContent = def.label;
  wrap.appendChild(label);

  let input;
  if (def.type === "select" || def.type === "selectFile") {
    input = document.createElement("select");
    input.appendChild(new Option("", ""));
    const options = def.type === "selectFile" ? files.media.map(file => file.path) : def.options;
    for (const option of options) input.appendChild(new Option(option, option === "none" ? "" : option));
  } else if (def.type === "multiFile") {
    input = document.createElement("select");
    input.multiple = true;
    input.size = Math.min(8, Math.max(3, files.media.length));
    for (const file of files.media) input.appendChild(new Option(file.name, file.path));
  } else if (def.type === "textarea") {
    input = document.createElement("textarea");
  } else if (def.type === "checkbox") {
    input = document.createElement("input");
    input.type = "checkbox";
    input.checked = Boolean(def.checked);
  } else {
    input = document.createElement("input");
    input.type = def.type || "text";
  }

  input.id = key;
  input.name = key;
  if (def.placeholder) input.placeholder = def.placeholder;
  if (value !== undefined) {
    if (input.type === "checkbox") input.checked = Boolean(value);
    else if (input.multiple && Array.isArray(value)) {
      for (const option of input.options) option.selected = value.includes(option.value);
    } else {
      input.value = value;
    }
  }
  wrap.appendChild(input);
  return wrap;
}

function collect() {
  const data = { mode: currentMode };
  for (const key of modes[currentMode].fields) {
    const element = form.elements[key];
    if (!element) continue;
    if (element.type === "checkbox") data[key] = element.checked;
    else if (element.multiple) data[key] = Array.from(element.selectedOptions).map(option => option.value);
    else if (element.value !== "") data[key] = element.value;
  }
  return data;
}

function preview() {
  const data = collect();
  commandPreview.textContent = buildClientPreview(data);
}

function updatePreviewFromForm() {
  const input = form.elements.input;
  if (input && input.value && input.value !== selectedPreviewPath) {
    loadPreview(input.value);
  }
  syncLiveAudioFromForm();
}

function buildClientPreview(data) {
  if (data.mode === "advanced") return `ffmpeg ${data.args || ""}`.trim();
  const input = data.input || "[input]";
  const output = data.output || `[output.${data.mode === "gif" ? "gif" : "mp4"}]`;
  return `ffmpeg -y -i "${input}" ${data.extraArgs || "[selected options]"} "${output}"`;
}

async function run() {
  log.textContent = "";
  if (currentMode === "probe") {
    const response = await fetch("/api/probe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(collect())
    });
    const result = await response.json();
    log.textContent = response.ok ? JSON.stringify(result, null, 2) : result.error || "FFprobe failed.";
    commandPreview.textContent = `ffprobe -v error -print_format json -show_format -show_streams "${collect().input || "[input]"}"`;
    return;
  }

  const response = await fetch("/api/run", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(collect())
  });
  const result = await response.json();
  if (!response.ok) {
    log.textContent = result.error || "Failed to start FFmpeg.";
    return;
  }
  activeJob = result.id;
  commandPreview.textContent = result.command;
}

async function stopJob() {
  if (!activeJob) return;
  await fetch(`/api/jobs/${activeJob}/stop`, { method: "POST" });
}

async function uploadFiles(fileList) {
  if (!fileList.length) return;
  const body = new FormData();
  for (const file of fileList) body.append("files", file);
  await fetch("/api/upload", { method: "POST", body });
  await loadFiles();
}

async function loadStatus() {
  const response = await fetch("/api/status");
  const status = await response.json();
  document.querySelector("#status").textContent = status.ffmpeg || "FFmpeg was not found.";
  document.querySelector("#mediaPath").textContent = status.mediaDir;
  document.querySelector("#outputPath").textContent = status.outputDir;
}

async function loadFiles() {
  const response = await fetch("/api/files");
  files = await response.json();
  renderFiles("mediaFiles", files.media, "media");
  renderFiles("outputFiles", files.outputs, "outputs");
  renderForm();
  restorePreviewSelection();
  preview();
}

function renderFiles(id, list, kind) {
  const target = document.querySelector(`#${id}`);
  target.innerHTML = "";
  if (!list.length) {
    const empty = document.createElement("p");
    empty.className = "hint";
    empty.textContent = "No files yet.";
    target.appendChild(empty);
    return;
  }
  for (const file of list) {
    const item = document.createElement("div");
    item.className = "fileItem";
    const info = document.createElement("div");
    info.innerHTML = `<strong>${escapeHtml(file.name)}</strong><span>${formatBytes(file.size)}</span>`;
    item.appendChild(info);
    const actions = document.createElement("div");
    actions.className = "fileActions";
    if (kind === "media") {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = "Use";
      button.addEventListener("click", () => {
        const input = form.elements.input;
        if (input) input.value = file.path;
        loadPreview(file.path);
        preview();
      });
      actions.appendChild(button);
    } else {
      const link = document.createElement("a");
      link.href = file.url;
      link.textContent = "Open";
      link.target = "_blank";
      actions.appendChild(link);
    }

    const deleteButton = document.createElement("button");
    deleteButton.type = "button";
    deleteButton.className = "danger";
    deleteButton.textContent = "Delete";
    deleteButton.addEventListener("click", () => deleteFile(kind, file));
    actions.appendChild(deleteButton);
    item.appendChild(actions);
    target.appendChild(item);
  }
}

function connectSocket() {
  const socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`);
  socket.addEventListener("message", event => {
    const message = JSON.parse(event.data);
    if (message.type === "log" && message.id === activeJob) {
      log.textContent += message.chunk;
      log.scrollTop = log.scrollHeight;
    }
    if (message.type === "files") {
      files = message.files;
      renderFiles("mediaFiles", files.media, "media");
      renderFiles("outputFiles", files.outputs, "outputs");
      renderForm();
      restorePreviewSelection();
    }
  });
}

async function deleteFile(kind, file) {
  const ok = confirm(`Delete ${file.name}?`);
  if (!ok) return;

  const response = await fetch(`/api/files/${kind}/${encodeURIComponent(file.name)}`, { method: "DELETE" });
  const result = await response.json();
  if (!response.ok) {
    log.textContent = result.error || "Delete failed.";
    return;
  }

  files = result.files;
  if (selectedPreviewPath === file.path) clearPreview();
  renderFiles("mediaFiles", files.media, "media");
  renderFiles("outputFiles", files.outputs, "outputs");
  renderForm();
  restorePreviewSelection();
  preview();
}

function loadPreview(filePath) {
  const file = findMediaFile(filePath);
  if (!file) return;
  selectedPreviewPath = file.path;
  previewName.textContent = file.name;
  mediaPlayer.src = file.url;
  mediaPlayer.load();
  setInputValue(file.path);
}

function clearPreview() {
  selectedPreviewPath = "";
  mediaPlayer.removeAttribute("src");
  mediaPlayer.load();
  previewName.textContent = "Choose an input file to preview it here.";
  trimStart = 0;
  trimEnd = 0;
  updatePlayerTime();
}

function restorePreviewSelection() {
  if (selectedPreviewPath) {
    setInputValue(selectedPreviewPath);
    return;
  }
  const input = form.elements.input;
  if (input && input.value) loadPreview(input.value);
}

function findMediaFile(filePath) {
  return files.media.find(file => file.path === filePath || file.name === filePath || file.url === filePath);
}

function setInputValue(filePath) {
  const input = form.elements.input;
  if (input) input.value = filePath;
}

function updatePlayerTime() {
  currentTime.textContent = formatTime(mediaPlayer.currentTime || 0);
  durationTime.textContent = Number.isFinite(mediaPlayer.duration) ? formatTime(mediaPlayer.duration) : "00:00:00.000";
  syncTrimUi();
}

function markCutPoint(kind) {
  if (!selectedPreviewPath) return;
  const seconds = mediaPlayer.currentTime || 0;
  if (kind === "start") {
    trimStart = Math.min(seconds, trimEnd || getDuration());
  } else {
    trimEnd = Math.max(seconds, trimStart);
  }
  applyTrimToForm();
}

function applyTrimToForm() {
  if (!["trim", "gif", "frames"].includes(currentMode)) setMode("trim");
  setInputValue(selectedPreviewPath);

  setFieldValue("start", formatTime(trimStart));
  setFieldValue("to", formatTime(trimEnd || getDuration()));
  setFieldValue("duration", "");
  syncTrimUi();
  preview();
}

function setFieldValue(name, value) {
  const field = form.elements[name];
  if (field) field.value = value;
}

function syncLiveAudioFromForm() {
  if (currentMode !== "audio") return;
  const formVolume = form.elements.volume?.value;
  const formBass = form.elements.bassGain?.value;
  const formTreble = form.elements.trebleGain?.value;

  if (formVolume !== undefined && formVolume !== "" && !formVolume.includes("dB")) liveVolume.value = clamp(Number(formVolume), 0, 2);
  if (formBass !== undefined && formBass !== "") liveBass.value = clamp(Number(formBass), -20, 20);
  if (formTreble !== undefined && formTreble !== "") liveTreble.value = clamp(Number(formTreble), -20, 20);
  updateLiveAudio();
}

function syncLiveAudioToForm() {
  if (currentMode !== "audio") return;
  setFieldValue("volume", Number(liveVolume.value).toFixed(2));
  setFieldValue("bassGain", liveBass.value);
  setFieldValue("trebleGain", liveTreble.value);
  preview();
}

function initPreviewAudio() {
  if (audioContext) {
    audioContext.resume();
    return;
  }

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return;

  audioContext = new AudioContextClass();
  mediaSourceNode = audioContext.createMediaElementSource(mediaPlayer);
  bassFilter = audioContext.createBiquadFilter();
  trebleFilter = audioContext.createBiquadFilter();
  previewGain = audioContext.createGain();

  bassFilter.type = "lowshelf";
  bassFilter.frequency.value = 160;
  trebleFilter.type = "highshelf";
  trebleFilter.frequency.value = 4000;

  mediaSourceNode
    .connect(bassFilter)
    .connect(trebleFilter)
    .connect(previewGain)
    .connect(audioContext.destination);
  updateLiveAudio();
}

function updateLiveAudio() {
  const volume = Number(liveVolume.value);
  const bass = Number(liveBass.value);
  const treble = Number(liveTreble.value);

  liveVolumeValue.textContent = `${volume.toFixed(2)}x`;
  liveBassValue.textContent = `${bass} dB`;
  liveTrebleValue.textContent = `${treble} dB`;

  if (previewGain) previewGain.gain.value = volume;
  if (bassFilter) bassFilter.gain.value = bass;
  if (trebleFilter) trebleFilter.gain.value = treble;

  if (currentMode === "audio") {
    setFieldValue("volume", volume.toFixed(2));
    setFieldValue("bassGain", String(bass));
    setFieldValue("trebleGain", String(treble));
    preview();
  }
}

function seekBy(seconds) {
  if (!mediaPlayer.src) return;
  const nextTime = Math.max(0, Math.min(mediaPlayer.duration || Infinity, mediaPlayer.currentTime + seconds));
  mediaPlayer.currentTime = nextTime;
  updatePlayerTime();
}

function seekTimeline(event) {
  if (!mediaPlayer.src) return;
  mediaPlayer.currentTime = timeFromPointer(event);
  updatePlayerTime();
}

function startDrag(event, handle) {
  if (!mediaPlayer.src) return;
  activeHandle = handle;
  event.currentTarget.setPointerCapture(event.pointerId);
  dragHandle(event);
}

function dragHandle(event) {
  if (!activeHandle) return;
  const time = timeFromPointer(event);
  if (activeHandle === "start") {
    trimStart = Math.min(time, trimEnd || getDuration());
    mediaPlayer.currentTime = trimStart;
  } else {
    trimEnd = Math.max(time, trimStart);
    mediaPlayer.currentTime = trimEnd;
  }
  applyTrimToForm();
}

function stopDrag() {
  activeHandle = null;
}

function timeFromPointer(event) {
  const duration = getDuration();
  if (!duration) return 0;
  const rect = timelineTrack.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  return ratio * duration;
}

function syncTrimUi() {
  const duration = getDuration();
  const end = trimEnd || duration;
  const startPercent = duration ? (trimStart / duration) * 100 : 0;
  const endPercent = duration ? (end / duration) * 100 : 100;
  const playPercent = duration ? ((mediaPlayer.currentTime || 0) / duration) * 100 : 0;

  startHandle.style.left = `${startPercent}%`;
  endHandle.style.left = `${endPercent}%`;
  playhead.style.left = `${playPercent}%`;
  timelineSelection.style.left = `${startPercent}%`;
  timelineSelection.style.right = `${100 - endPercent}%`;
  trimStartLabel.textContent = formatTime(trimStart);
  trimEndLabel.textContent = formatTime(end);
}

function getDuration() {
  return Number.isFinite(mediaPlayer.duration) ? mediaPlayer.duration : 0;
}

function formatTime(seconds) {
  const safeSeconds = Math.max(0, seconds || 0);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const secs = Math.floor(safeSeconds % 60);
  const millis = Math.floor((safeSeconds - Math.floor(safeSeconds)) * 1000);
  return `${pad(hours)}:${pad(minutes)}:${pad(secs)}.${String(millis).padStart(3, "0")}`;
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(max, value));
}

function formatBytes(bytes) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / Math.pow(1024, index)).toFixed(index ? 1 : 0)} ${units[index]}`;
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;" }[char]));
}
