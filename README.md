# Audio Video Edit

A local browser UI for FFmpeg on this laptop.

## Run

```powershell
npm install
npm start
```

Open:

```text
http://localhost:5173
```

## What It Does

- Upload or drag media into the project `media` folder.
- Convert, trim, edit audio, edit video, extract audio, create GIFs, export frames, add subtitles, merge files, and inspect files with FFprobe.
- Use **Advanced** mode for the full FFmpeg feature set by entering any FFmpeg argument list directly.
- Finished files are written to `outputs`.

The app runs FFmpeg locally. It does not upload your media anywhere outside this machine.
