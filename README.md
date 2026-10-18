# SingAlong

SingAlong is a web app for practicing singing along with your favorite songs. Search for a song on YouTube or paste a link, follow the lyrics, and record yourself singing over it. Separate the original singer's vocals from the instrumental, turn their voice down as you practice, or mute it and sing in their place.

The idea is to make shadow singing simple: start by singing with the artist, then gradually rely on your own voice.

**[Try the live demo](https://saurvv1.github.io/SingAlong/)** — no installation required.

## Features

- Search YouTube by song title or paste a video link.
- Play the video with a seek bar and waveform timeline.
- Separate vocals and instrumental audio using Demucs.
- Adjust the original singer's vocal volume or mute their vocals.
- Record your microphone and play your recording along with the song.
- Follow synchronized lyrics from LRCLIB when available.
- Add sounds with a keyboard sampler and capture them on an instrument timeline.
- Reuse cached audio and separated stems when processing the same song again.

## Project status

SingAlong is in an early stage and is under active development. A public portfolio demo is hosted on GitHub Pages. Searching and processing other songs currently requires running the full app locally.

The interactive portfolio demo features the full music video version of Drake's **Janice STFU**, its YouTube embed, and prepared vocal and instrumental tracks. Try it locally with `npm run dev:demo` from `singalong`. This demo does not need the Python backend. Lyrics are unavailable for the selected track. Screenshots will be added later.

See [DEPLOYMENT.md](DEPLOYMENT.md) for free GitHub Pages deployment instructions and production preview steps.

## Run locally

These instructions are for running the full app from source. The hosted demo does not require this setup.

### Requirements

- A recent Node.js LTS release and npm.
- Python 3.10 or newer.
- FFmpeg and ffprobe available on your PATH.
- An internet connection and a browser with microphone access.

### Setup on Windows (PowerShell)

From the repository root, create the backend environment and install dependencies:

```powershell
cd backend
py -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
cd ..\singalong
npm install
npm run dev
```

Open the localhost URL printed in the terminal, normally http://localhost:5173. The development command starts both the frontend and the audio service. Keep the terminal open; press Ctrl+C to stop them.

For later sessions, run `npm run dev` from the `singalong` directory. The first vocal separation downloads model weights, and processing a full song on a CPU can take several minutes.

### Frontend production build

From the `singalong` directory:

```powershell
npm run build
```

This builds the frontend into `singalong/dist`. The Python backend must be hosted separately or served alongside it; publishing these static files alone does not provide search or vocal separation. The current backend address and allowed frontend origins still need deployment configuration.

## Current limitations

- YouTube playback depends on video availability and embedding permissions. Playback errors are still being investigated.
- Synchronized lyrics are not available for every song, and automatic matching may select a different version.
- Vocal separation is resource intensive and may leave some vocals or instrumental artifacts.
- This is an early prototype; recording, synchronization, and browser behavior still need broader testing.
- Free public hosting for the complete audio-processing workflow has not been validated yet.

## Planned improvements

- Improve playback reliability and error messages.
- Improve lyrics matching and recording synchronization.
- Expand and improve the free public demo.
- Improve the interface and add screenshots and a walkthrough.

## Built with

React, TypeScript, Vite, Python, FastAPI, Demucs, yt-dlp, FFmpeg, the YouTube IFrame Player API, and LRCLIB.

Backend details and cache behavior are documented in [backend/README.md](backend/README.md).
