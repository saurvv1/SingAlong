import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import "./App.css";

declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const SEPARATOR_URL = "http://localhost:8000/api/separate";
let youtubeApiPromise: Promise<void> | null = null;

function loadYouTubeApi() {
  if (window.YT?.Player) return Promise.resolve();
  if (!youtubeApiPromise) {
    youtubeApiPromise = new Promise((resolve) => {
      window.onYouTubeIframeAPIReady = () => resolve();
      if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
        const script = document.createElement("script");
        script.src = "https://www.youtube.com/iframe_api";
        script.async = true;
        document.head.appendChild(script);
      }
    });
  }
  return youtubeApiPromise;
}

function getYouTubeId(value: string): string | null {
  try {
    const input = value.trim();
    const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(input) ? input : `https://${input}`);
    const host = url.hostname.replace(/^www\./, "");
    let id: string | null = null;

    if (host === "youtu.be") id = url.pathname.slice(1).split("/")[0] || null;
    if (["youtube.com", "m.youtube.com"].includes(host)) {
      if (url.pathname === "/watch") id = url.searchParams.get("v");
      else if (/^\/(shorts|embed|live)\//.test(url.pathname)) id = url.pathname.split("/")[2] || null;
    }

    return id && /^[\w-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

type Stems = { vocals: string; instrumental: string };

export default function App() {
  const [url, setUrl] = useState("");
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [audioUrl, setAudioUrl] = useState("");
  const [audioName, setAudioName] = useState("");
  const [waveform, setWaveform] = useState<number[]>([]);
  const [stems, setStems] = useState<Stems | null>(null);
  const [vocalEnabled, setVocalEnabled] = useState(true);
  const [vocalVolume, setVocalVolume] = useState(1);
  const [separating, setSeparating] = useState(false);
  const [separationProgress, setSeparationProgress] = useState(0);
  const [separationMessage, setSeparationMessage] = useState("");
  const [error, setError] = useState("");
  const [youtubePlaying, setYoutubePlaying] = useState(false);

  const playerContainerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);
  const playbackIntentRef = useRef(false);
  const resumingFromBackgroundRef = useRef(false);
  const waveformRef = useRef<HTMLCanvasElement>(null);
  const selectedFileRef = useRef<File | null>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const vocalsRef = useRef<HTMLAudioElement>(null);
  const instrumentalRef = useRef<HTMLAudioElement>(null);
  const videoId = getYouTubeId(url);

  useEffect(() => {
    if (!videoId || !playerContainerRef.current) return;
    let disposed = false;
    let timer: number | undefined;

    setDuration(0);
    setCurrentTime(0);
    loadYouTubeApi().then(() => {
      if (disposed || !playerContainerRef.current) return;
      playerRef.current = new window.YT!.Player(playerContainerRef.current, {
        videoId,
        playerVars: { playsinline: 1 },
        events: {
          onReady: (event: any) => {
            setDuration(event.target.getDuration() || 0);
            if (audioUrl) event.target.mute();
            timer = window.setInterval(() => {
              setCurrentTime(event.target.getCurrentTime() || 0);
              setDuration(event.target.getDuration() || 0);
            }, 200);
          },
          onStateChange: (event: any) => {
            if (event.data === 1) {
              playbackIntentRef.current = true;
              resumingFromBackgroundRef.current = false;
            } else if (event.data === 0) {
              playbackIntentRef.current = false;
            } else if (
              event.data === 2 &&
              !document.hidden &&
              document.hasFocus() &&
              !resumingFromBackgroundRef.current
            ) {
              playbackIntentRef.current = false;
            }
            setYoutubePlaying(event.data === 1);
          },
        },
      });
    });

    return () => {
      disposed = true;
      if (timer) window.clearInterval(timer);
      playerRef.current?.destroy();
      playerRef.current = null;
      playbackIntentRef.current = false;
      resumingFromBackgroundRef.current = false;
      setYoutubePlaying(false);
    };
  }, [videoId]);

  useEffect(() => {
    if (audioUrl) playerRef.current?.mute();
    else playerRef.current?.unMute();
  }, [audioUrl]);

  useEffect(() => {
    if (!videoId) {
      [audioRef.current, vocalsRef.current, instrumentalRef.current].forEach((track) => track?.pause());
    }
  }, [videoId]);

  useEffect(() => () => {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
  }, [audioUrl]);

  useEffect(() => {
    const canvas = waveformRef.current;
    if (!canvas || !waveform.length) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * ratio);
    canvas.height = Math.round(rect.height * ratio);
    const context = canvas.getContext("2d");
    if (!context) return;
    context.scale(ratio, ratio);
    context.clearRect(0, 0, rect.width, rect.height);
    const barWidth = rect.width / waveform.length;
    const progress = duration ? currentTime / duration : 0;
    waveform.forEach((peak, index) => {
      const height = Math.max(2, peak * rect.height * 0.9);
      const x = index * barWidth;
      context.fillStyle = index / waveform.length <= progress ? "#c084fc" : "#52525f";
      context.fillRect(x, (rect.height - height) / 2, Math.max(1, barWidth - 1), height);
    });
  }, [waveform, currentTime, duration]);

  useEffect(() => {
    const player = playerRef.current;
    if (!audioUrl || !videoId || !player) return;
    const syncAudio = () => {
      try {
        const playerState = player.getPlayerState();
        const pageIsBackground = document.hidden || !document.hasFocus();
        const time = player.getCurrentTime();
        // The uploaded file remains the clock while the YouTube iframe
        // buffers or resumes after the page regains focus.
        const playing = playbackIntentRef.current;
        const tracks = stems
          ? [instrumentalRef.current, ...(vocalEnabled ? [vocalsRef.current] : [])]
          : [audioRef.current];

        if (stems) {
          audioRef.current?.pause();
          if (vocalsRef.current) vocalsRef.current.volume = vocalVolume;
          if (!vocalEnabled) vocalsRef.current?.pause();
        }

        tracks.forEach((track) => {
          if (!track) return;
          if (
            !pageIsBackground &&
            !resumingFromBackgroundRef.current &&
            playerState === 1 &&
            Math.abs(track.currentTime - time) > 0.25
          ) {
            track.currentTime = time;
          }
          if (playing && track.paused) void track.play().catch(() => {});
          if (!playing && !track.paused) track.pause();
        });
      } catch {
        // The YouTube player may not be ready yet.
      }
    };

    syncAudio();
    const timer = window.setInterval(syncAudio, 200);
    return () => window.clearInterval(timer);
  }, [audioUrl, stems, vocalEnabled, vocalVolume, youtubePlaying, videoId]);

  useEffect(() => {
    if (!audioUrl || !videoId) return;
    const resumeInForeground = () => {
      if (document.hidden || !document.hasFocus() || !playbackIntentRef.current) return;
      const player = playerRef.current;
      if (!player) return;

      try {
        // Focusing the window fires even if YouTube kept playing. Seeking in
        // that case can force a rebuffer and cause an audible stutter.
        if (player.getPlayerState() === 1) {
          resumingFromBackgroundRef.current = false;
        } else {
          resumingFromBackgroundRef.current = true;
          const audioTime = (stems ? instrumentalRef.current : audioRef.current)?.currentTime;
          if (typeof audioTime === "number" && Number.isFinite(audioTime)) {
            player.seekTo(audioTime, true);
          }
          player.playVideo();
        }
      } catch {
        // The player may be changing videos.
      }
    };

    document.addEventListener("visibilitychange", resumeInForeground);
    const rememberBackgroundPlayback = () => {
      if (playbackIntentRef.current) resumingFromBackgroundRef.current = true;
    };
    window.addEventListener("blur", rememberBackgroundPlayback);
    window.addEventListener("focus", resumeInForeground);
    return () => {
      document.removeEventListener("visibilitychange", resumeInForeground);
      window.removeEventListener("blur", rememberBackgroundPlayback);
      window.removeEventListener("focus", resumeInForeground);
    };
  }, [audioUrl, stems, videoId]);

  useEffect(() => {
    if (
      audioUrl &&
      playerRef.current &&
      !resumingFromBackgroundRef.current &&
      !document.hidden &&
      document.hasFocus()
    ) {
      try {
        const tracks = [audioRef.current, vocalsRef.current, instrumentalRef.current];
        tracks.forEach((track) => {
          if (track && Math.abs(track.currentTime - currentTime) > 0.4) track.currentTime = currentTime;
        });
      } catch {
        // Track metadata may still be loading.
      }
    }
  }, [currentTime, audioUrl]);

  const formatTime = (value: number) => {
    const seconds = Math.floor(value || 0);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  };

  const seek = (time: number) => {
    setCurrentTime(time);
    playerRef.current?.seekTo(time, true);
    [audioRef.current, vocalsRef.current, instrumentalRef.current].forEach((track) => {
      if (track) track.currentTime = time;
    });
  };

  const loadAudio = async (file?: File) => {
    if (!file) return;
    selectedFileRef.current = file;
    setError("");
    setStems(null);
    setVocalEnabled(true);
    setVocalVolume(1);
    setAudioName(file.name);
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(URL.createObjectURL(file));

    try {
      const audioContext = new AudioContext();
      const decoded = await audioContext.decodeAudioData(await file.arrayBuffer());
      await audioContext.close();
      const samples = decoded.getChannelData(0);
      const count = Math.min(1400, Math.floor(samples.length / 256));
      const bucketSize = Math.max(1, Math.floor(samples.length / count));
      const peaks = Array.from({ length: count }, (_, bucket) => {
        let peak = 0;
        const start = bucket * bucketSize;
        const end = Math.min(samples.length, start + bucketSize);
        for (let i = start; i < end; i += 1) peak = Math.max(peak, Math.abs(samples[i]));
        return peak;
      });
      setWaveform(peaks);
      if (!playerRef.current) setDuration(decoded.duration);
    } catch {
      setError("This audio file could not be decoded by the browser.");
    }
  };

  const separateVocals = async () => {
    const file = selectedFileRef.current;
    if (!file) return;
    setSeparating(true);
    setError("");
    setSeparationProgress(1);
    setSeparationMessage("Uploading audio…");
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch(SEPARATOR_URL, { method: "POST", body: form });
      const job = await response.json();
      if (!response.ok) throw new Error(job.detail || "Vocal separation failed.");

      let result: any;
      while (true) {
        await new Promise((resolve) => window.setTimeout(resolve, 500));
        const statusResponse = await fetch(`${SEPARATOR_URL}/${job.jobId}`);
        result = await statusResponse.json();
        if (!statusResponse.ok) throw new Error(result.detail || "Could not read separation progress.");
        setSeparationProgress(result.progress || 0);
        setSeparationMessage(result.message || "Separating vocals…");
        if (result.status === "failed") throw new Error(result.message || "Vocal separation failed.");
        if (result.status === "completed") break;
      }

      setStems({
        vocals: `http://localhost:8000${result.vocals}`,
        instrumental: `http://localhost:8000${result.instrumental}`,
      });
    } catch (cause) {
      setError(
        cause instanceof TypeError
          ? "Can't reach the local vocal separation service. Start it from the backend folder with: .\\.venv\\Scripts\\Activate.ps1, then python -m uvicorn app:app --reload --port 8000."
          : cause instanceof Error
            ? cause.message
            : "Vocal separation failed. Check that the local service is running.",
      );
    } finally {
      setSeparating(false);
    }
  };

  const moveWithKeyboard = (event: KeyboardEvent<HTMLCanvasElement>) => {
    if (!duration) return;
    if (event.key === "ArrowRight") seek(Math.min(duration, currentTime + 5));
    if (event.key === "ArrowLeft") seek(Math.max(0, currentTime - 5));
  };

  return (
    <main className="app">
      <input
        className="youtube-input"
        type="url"
        aria-label="YouTube video link"
        placeholder="Paste a YouTube video link"
        value={url}
        onChange={(event) => setUrl(event.target.value)}
        autoComplete="url"
      />

      {videoId && (
        <>
          <div className="youtube-player"><div ref={playerContainerRef} /></div>
          <div className="timeline-times"><span>{formatTime(currentTime)}</span><span>{formatTime(duration)}</span></div>
          <canvas
            ref={waveformRef}
            className={`waveform${audioUrl ? " waveform-ready" : ""}`}
            role="slider"
            aria-label="Audio waveform timeline"
            aria-valuemin={0}
            aria-valuemax={Math.floor(duration)}
            aria-valuenow={Math.floor(currentTime)}
            tabIndex={duration ? 0 : -1}
            onClick={(event) => {
              if (duration) {
                const rect = event.currentTarget.getBoundingClientRect();
                seek(((event.clientX - rect.left) / rect.width) * duration);
              }
            }}
            onKeyDown={moveWithKeyboard}
          />

          <div className="audio-actions">
            <label className="upload-button" htmlFor="audio-file">{audioName ? "Replace audio" : "Upload matching audio"}</label>
            <input id="audio-file" className="file-input" type="file" accept="audio/*" onChange={(event) => void loadAudio(event.target.files?.[0])} />
            {audioName && <span className="audio-name">{audioName}</span>}
            {audioUrl && !stems && (
              <button className="action-button" onClick={() => void separateVocals()} disabled={separating}>
                {separating ? "Separating…" : "Separate vocals"}
              </button>
            )}
            {stems && (
              <>
                <button className="action-button" onClick={() => setVocalEnabled((enabled) => !enabled)}>
                  Vocals: {vocalEnabled ? "On" : "Off"}
                </button>
                <label className="vocal-volume">
                  <span>Vocal volume</span>
                  <input
                    type="range"
                    min="0"
                    max="100"
                    value={Math.round(vocalVolume * 100)}
                    aria-label="Vocal volume"
                    onChange={(event) => setVocalVolume(Number(event.target.value) / 100)}
                  />
                  <span>{Math.round(vocalVolume * 100)}%</span>
                </label>
              </>
            )}
          </div>
          {separating && (
            <div className="separation-progress">
              <div className="progress-label">
                <span>{separationMessage}</span>
                <span>{separationProgress}%</span>
              </div>
              <progress value={separationProgress} max="100" aria-label="Vocal separation progress" />
            </div>
          )}
          <p className="audio-note">Upload audio you’re allowed to use. The local separation service is needed for vocal removal.</p>
          {error && <p className="error-message">{error}</p>}

          {audioUrl && <audio ref={audioRef} src={audioUrl} preload="auto" />}
          {stems && (
            <>
              <audio ref={vocalsRef} src={stems.vocals} preload="auto" />
              <audio ref={instrumentalRef} src={stems.instrumental} preload="auto" />
            </>
          )}
        </>
      )}
    </main>
  );
}
