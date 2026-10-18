# Free portfolio demo

The GitHub Pages build enables a prepared-song demo of Drake's **Janice STFU**, using the full music video version from the beginning. It embeds the music video (`SD4yRDY9mek`) and uses audio prepared from that same video for the recording, vocal controls, and sampler without starting the Python backend. If YouTube playback fails, the prepared audio remains usable. The regular local app keeps its YouTube search and processing features.

LRCLIB provides plain lyrics for this track, but no synchronized timestamps. The demo includes those lyrics in a scrollable panel. When timestamped lyrics are added, the existing synchronized display takes priority over the plain text.

## Prepare the song

Use a recording and lyrics you have permission to redistribute publicly, including the separated stems. Files in this folder will be publicly downloadable.

1. Prepare the song (or a shorter excerpt) and its vocal and instrumental stems using the local backend.
2. Place the three audio files in `singalong/public/demo/`.
3. Copy `song.example.json` to `song.json` in the same directory.
4. Fill in the title, artist, credit, audio filenames, YouTube ID, and original song start time in seconds. All three audio tracks must have matching start times and duration. Use the same clip boundaries for every track. Set `syncedLyrics` to timestamped LRC text relative to the excerpt, or an empty string when unavailable. Set `plainLyrics` to the lyrics text to provide a readable fallback without timestamps.
5. Use your own credit text; the example is a placeholder, not a license grant.

The original audio is the playback clock; it is muted while the prepared vocal and instrumental tracks play. Recordings stay in memory in the visitor's browser session and are not uploaded. Sampler sounds are stored in that browser's local library.

## Run the demo locally

From the `singalong` directory, run `npm run dev:demo` and open the localhost URL. This starts only the frontend, with no Python backend required. Use `npm.cmd` if PowerShell blocks `npm.ps1`.

## Check the production build on Windows

From the `singalong` directory:

```powershell
node scripts/check-demo.mjs
$env:VITE_DEMO_MODE = "true"
npm.cmd run build -- --base=/SingAlong/
Remove-Item Env:VITE_DEMO_MODE
npm.cmd run preview -- --base=/SingAlong/
```

Open the preview URL with `/SingAlong/` appended. Check loading, play/pause, seeking, lyric timing, vocal volume and mute, microphone recording and replay, and the sampler. Use headphones to avoid microphone feedback. Confirm it works with the Python backend stopped. `npm run preview` serves the last build; it does not start the backend.

## Publish

1. Commit and push the demo code and audio files to GitHub.
2. In the repository, open **Settings → Pages** and choose **GitHub Actions** as the source.
3. Open **Actions → Deploy portfolio demo → Run workflow** on `main`.
4. Wait for a successful deployment and use the URL shown by the workflow, normally `https://saurvv1.github.io/SingAlong/`.

The workflow is manual and fails if the song metadata or audio files are missing, or supplied lyrics have no timestamps. It builds with the repository's name as the URL base, so asset paths also work under a GitHub project page. No paid hosting or custom domain is required.

## Current verification

The regular app and portfolio demo production builds pass. The GitHub Pages deployment succeeded, and the public page, song metadata, and three audio files return successful HTTP responses with the expected content types.

Build checks do not verify audio quality, lyric alignment, browser microphone permissions, or real-device recording behavior. Complete the preview checks with the actual song before publishing.
