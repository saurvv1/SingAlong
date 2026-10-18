# Local vocal separation service

This local service extracts audio from a YouTube video URL and separates audio into vocal and instrumental MP3 stems. Use it only for videos you own or are allowed to download.

## Setup (Windows PowerShell)

Install Python 3.10 or newer and FFmpeg, then run:

```powershell
cd backend
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
python -m uvicorn app:app --port 8001
```

After this one-time setup, start both the web app and audio service together by running `npm run dev` from the `singalong` folder. Keep that terminal open while using the app; stopping it shuts down both servers. After restarting your computer, just run `npm run dev` again. If backend dependencies change, install them with `python -m pip install -r requirements.txt` after activating the virtual environment. FFmpeg and ffprobe must be installed and available on `PATH`.

The first vocal separation downloads the Demucs model and can take a while; CPU separation may also take several minutes for a full song.

Completed stems are kept in `backend/generated` and keyed by the SHA-256 hash of the audio bytes. Processing the same audio again reuses those stems without running Demucs again, including after restarting the backend. Different file contents are treated as a new song. Remove the matching hash-named folder from `backend/generated` to clear a cached separation.
