from pathlib import Path
import os
import re
import hashlib
import asyncio
import json
import logging
import subprocess
import sys
import threading
import time
from urllib.parse import parse_qs, urlencode, urlparse
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool


ROOT = Path(__file__).parent
OUTPUTS = ROOT / "generated"
OUTPUTS.mkdir(exist_ok=True)
DOWNLOADS = ROOT / "downloads"
DOWNLOADS.mkdir(exist_ok=True)
LOGGER = logging.getLogger("singalong.lyrics")
JOBS: dict[str, dict] = {}
JOBS_LOCK = threading.Lock()
DOWNLOAD_LOCKS: dict[str, asyncio.Lock] = {}
DOWNLOAD_LOCKS_GUARD = threading.Lock()

app = FastAPI(title="SingAlong audio separation")
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)
app.mount("/generated", StaticFiles(directory=OUTPUTS), name="generated")
app.mount("/audio", StaticFiles(directory=DOWNLOADS), name="audio")


class YouTubeAudioRequest(BaseModel):
    url: str


def find_lyrics(track_name: str, artist_name: str | None = None):
    query = {"track_name": track_name}
    if artist_name:
        query["artist_name"] = artist_name
    request = Request(
        f"https://lrclib.net/api/search?{urlencode(query)}",
        headers={"User-Agent": "SingAlong/0.1 (local lyrics search)"},
    )
    with urlopen(request, timeout=25) as response:
        results = json.loads(response.read().decode("utf-8"))
    return [result for result in results if result.get("syncedLyrics")]


def find_youtube_videos(query: str):
    import yt_dlp

    options = {
        "quiet": True,
        "no_warnings": True,
        "extract_flat": True,
        "skip_download": True,
        "playlistend": 8,
    }
    with yt_dlp.YoutubeDL(options) as downloader:
        result = downloader.extract_info(f"ytsearch8:{query}", download=False)
    videos = []
    for entry in result.get("entries") or []:
        video_id = entry.get("id")
        if not video_id or not re.fullmatch(r"[\w-]{11}", video_id):
            continue
        thumbnails = entry.get("thumbnails") or []
        videos.append({
            "id": video_id,
            "title": entry.get("title") or "Untitled video",
            "channel": entry.get("channel") or entry.get("uploader") or "YouTube",
            "thumbnail": entry.get("thumbnail") or (thumbnails[-1].get("url") if thumbnails else ""),
            "duration": entry.get("duration"),
        })
    return videos


@app.get("/api/youtube-search")
async def search_youtube_titles(query: str):
    query = query.strip()
    if not query or len(query) > 200:
        raise HTTPException(status_code=400, detail="Enter a search term up to 200 characters.")
    try:
        results = await run_in_threadpool(find_youtube_videos, query)
        return {"results": results}
    except Exception as error:
        raise HTTPException(status_code=502, detail="YouTube search failed. Check your internet connection and try again.") from error


@app.get("/api/lyrics/search")
async def search_lyrics(track_name: str):
    track_name = track_name.strip()
    if not track_name:
        raise HTTPException(status_code=400, detail="Enter a song title to search for lyrics.")
    try:
        results = await run_in_threadpool(find_lyrics, track_name)
        return {"results": results}
    except HTTPError as error:
        LOGGER.warning("LRCLIB returned HTTP %s while searching for %r", error.code, track_name)
        if error.code == 429:
            raise HTTPException(status_code=503, detail="LRCLIB is rate-limiting searches. Wait a little, then try again.") from error
        raise HTTPException(status_code=502, detail=f"LRCLIB returned HTTP {error.code}. Try the lyrics search again shortly.") from error
    except URLError as error:
        LOGGER.warning("Could not connect to LRCLIB while searching for %r: %s", track_name, error.reason)
        raise HTTPException(status_code=502, detail="Could not connect to LRCLIB. Check your internet connection and try again.") from error
    except TimeoutError as error:
        LOGGER.warning("LRCLIB search timed out for %r", track_name)
        raise HTTPException(status_code=504, detail="LRCLIB did not respond in time. Try the lyrics search again.") from error
    except HTTPException:
        raise
    except Exception as error:
        LOGGER.exception("Unexpected error searching LRCLIB for %r", track_name)
        raise HTTPException(status_code=502, detail="Lyrics search failed unexpectedly. Check the backend terminal for details.") from error


def get_youtube_id(value: str) -> str | None:
    try:
        parsed = urlparse(value.strip())
        host = (parsed.hostname or "").lower().removeprefix("www.")
        video_id = None
        if host == "youtu.be":
            video_id = parsed.path.strip("/").split("/")[0]
        elif host in {"youtube.com", "m.youtube.com", "music.youtube.com"}:
            if parsed.path == "/watch":
                video_id = parse_qs(parsed.query).get("v", [None])[0]
            elif re.match(r"^/(shorts|embed|live)/", parsed.path):
                video_id = parsed.path.split("/")[2]
        return video_id if video_id and re.fullmatch(r"[\w-]{11}", video_id) else None
    except ValueError:
        return None


def remove_expired_downloads():
    cutoff = time.time() - 24 * 60 * 60
    for folder in DOWNLOADS.iterdir():
        try:
            if folder.is_dir() and folder.stat().st_mtime < cutoff:
                for child in folder.iterdir():
                    if child.is_file():
                        child.unlink()
                folder.rmdir()
        except OSError:
            continue


def download_youtube_audio(url: str, download_dir: Path):
    import yt_dlp

    options = {
        "format": "bestaudio/best",
        "outtmpl": str(download_dir / "audio.%(ext)s"),
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "match_filter": lambda info, *, incomplete: (
            "Videos longer than two hours are not supported."
            if info.get("duration") and info["duration"] > 7200
            else None
        ),
        "postprocessors": [{
            "key": "FFmpegExtractAudio",
            "preferredcodec": "mp3",
            "preferredquality": "192",
        }],
    }
    with yt_dlp.YoutubeDL(options) as downloader:
        info = downloader.extract_info(url, download=True)
    audio_file = download_dir / "audio.mp3"
    if not audio_file.is_file():
        raise RuntimeError("yt-dlp did not create an MP3 audio file.")
    return info.get("title", "YouTube audio")


@app.post("/api/youtube-audio")
async def extract_youtube_audio(payload: YouTubeAudioRequest):
    video_id = get_youtube_id(payload.url)
    if not video_id:
        raise HTTPException(status_code=400, detail="Enter a valid YouTube video URL.")

    download_id = hashlib.sha256(video_id.encode("utf-8")).hexdigest()
    download_dir = DOWNLOADS / download_id
    audio_file = download_dir / "audio.mp3"
    with DOWNLOAD_LOCKS_GUARD:
        download_lock = DOWNLOAD_LOCKS.setdefault(download_id, asyncio.Lock())
    async with download_lock:
        remove_expired_downloads()
        if not audio_file.is_file():
            download_dir.mkdir(exist_ok=True)
            try:
                title = await run_in_threadpool(download_youtube_audio, payload.url, download_dir)
                (download_dir / "title.txt").write_text(title, encoding="utf-8")
            except Exception as error:
                for child in download_dir.iterdir():
                    if child.is_file():
                        child.unlink()
                raise HTTPException(status_code=502, detail=f"Could not extract this video's audio: {error}") from error
        else:
            title_file = download_dir / "title.txt"
            title = title_file.read_text(encoding="utf-8") if title_file.is_file() else "YouTube audio"
            os.utime(download_dir, None)

    return {
        "audio": f"/audio/{download_id}/audio.mp3",
        "title": title,
    }


def run_separation(job_id: str, source: Path, job_dir: Path):
    def update(**values):
        with JOBS_LOCK:
            JOBS[job_id].update(values)

    try:
        environment = os.environ.copy()
        environment["TORCH_HOME"] = str(ROOT / "models")
        (ROOT / "models").mkdir(exist_ok=True)
        process = subprocess.Popen(
            [
                sys.executable,
                "-m",
                "demucs",
                "--two-stems",
                "vocals",
                "--shifts",
                "0",
                "--overlap",
                "0.1",
                "-n",
                "htdemucs",
                "--mp3",
                "-o",
                str(job_dir),
                str(source),
            ],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.PIPE,
            env=environment,
            text=True,
            bufsize=1,
        )

        output_tail = ""
        progress_line = ""
        if process.stderr:
            while char := process.stderr.read(1):
                if char in "\r\n":
                    match = re.search(r"(\d{1,3})%", progress_line)
                    if match:
                        percent = min(95, 5 + int(match.group(1)) * 9 // 10)
                        update(progress=percent, message="Separating vocals and instrumental…")
                    output_tail = (output_tail + progress_line + "\n")[-5000:]
                    progress_line = ""
                else:
                    progress_line = (progress_line + char)[-1000:]
        return_code = process.wait()

        if return_code != 0:
            raise RuntimeError(output_tail.strip() or "Audio separation failed.")

        update(progress=97, message="Finishing audio files…")

        track_dir = job_dir / "htdemucs" / source.stem
        vocals = track_dir / "vocals.mp3"
        instrumental = track_dir / "no_vocals.mp3"
        if not vocals.exists() or not instrumental.exists():
            raise RuntimeError("The separation model did not produce both audio stems.")

        update(
            status="completed",
            progress=100,
            message="Vocals separated.",
            vocals=f"/generated/{job_id}/htdemucs/{source.stem}/vocals.mp3",
            instrumental=f"/generated/{job_id}/htdemucs/{source.stem}/no_vocals.mp3",
        )
    except Exception as error:
        update(status="failed", message=str(error))


@app.post("/api/separate")
async def separate_audio(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(status_code=400, detail="Choose an audio file first.")

    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=400, detail="The uploaded audio file is empty.")

    # Content-addressed job IDs make completed stems reusable across uploads and
    # backend restarts. The original filename does not affect the audio result.
    job_id = hashlib.sha256(contents).hexdigest()
    job_dir = OUTPUTS / job_id
    source = job_dir / f"source{Path(file.filename).suffix.lower()}"

    with JOBS_LOCK:
        vocals = job_dir / "htdemucs" / "source" / "vocals.mp3"
        instrumental = job_dir / "htdemucs" / "source" / "no_vocals.mp3"
        if vocals.is_file() and instrumental.is_file():
            JOBS[job_id] = {
                "status": "completed",
                "progress": 100,
                "message": "Reused saved vocal separation.",
                "vocals": f"/generated/{job_id}/htdemucs/source/vocals.mp3",
                "instrumental": f"/generated/{job_id}/htdemucs/source/no_vocals.mp3",
            }
            return {"jobId": job_id, "cached": True}
        if job_id in JOBS and JOBS[job_id]["status"] == "processing":
            return {"jobId": job_id, "cached": True}

        job_dir.mkdir(exist_ok=True)
        source.write_bytes(contents)
        JOBS[job_id] = {
            "status": "processing",
            "progress": 2,
            "message": "Starting vocal separation…",
        }

    threading.Thread(target=run_separation, args=(job_id, source, job_dir), daemon=True).start()
    return {"jobId": job_id}


@app.get("/api/separate/{job_id}")
async def get_separation_status(job_id: str):
    if not re.fullmatch(r"[a-f0-9]{64}", job_id):
        raise HTTPException(status_code=404, detail="Separation job not found.")
    with JOBS_LOCK:
        job = JOBS.get(job_id)
        if job is None:
            job_dir = OUTPUTS / job_id
            vocals = job_dir / "htdemucs" / "source" / "vocals.mp3"
            instrumental = job_dir / "htdemucs" / "source" / "no_vocals.mp3"
            if vocals.is_file() and instrumental.is_file():
                job = {
                    "status": "completed",
                    "progress": 100,
                    "message": "Reused saved vocal separation.",
                    "vocals": f"/generated/{job_id}/htdemucs/source/vocals.mp3",
                    "instrumental": f"/generated/{job_id}/htdemucs/source/no_vocals.mp3",
                }
                JOBS[job_id] = job
        if job is None:
            raise HTTPException(status_code=404, detail="Separation job not found.")
        return dict(job)
