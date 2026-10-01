import { useEffect, useRef, useState } from "react";
import "./App.css";

declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

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
    const url = new URL(
      /^[a-z][a-z\d+.-]*:\/\//i.test(input) ? input : `https://${input}`,
    );
    const host = url.hostname.replace(/^www\./, "");
    let id: string | null = null;

    if (host === "youtu.be") id = url.pathname.slice(1).split("/")[0] || null;
    if (host === "youtube.com" || host === "m.youtube.com") {
      if (url.pathname === "/watch") id = url.searchParams.get("v");
      else if (/^\/(shorts|embed|live)\//.test(url.pathname)) id = url.pathname.split("/")[2] || null;
    }

    return id && /^[\w-]{11}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

export default function App() {
  const [url, setUrl] = useState("");
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const playerContainerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);
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
            timer = window.setInterval(() => {
              setCurrentTime(event.target.getCurrentTime() || 0);
              setDuration(event.target.getDuration() || 0);
            }, 200);
          },
        },
      });
    });

    return () => {
      disposed = true;
      if (timer) window.clearInterval(timer);
      playerRef.current?.destroy();
      playerRef.current = null;
    };
  }, [videoId]);

  const seek = (time: number) => {
    setCurrentTime(time);
    playerRef.current?.seekTo(time, true);
  };

  const formatTime = (time: number) => {
    const seconds = Math.floor(time);
    return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
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
          <div className="youtube-player">
            <div ref={playerContainerRef} />
          </div>
          <div className="timeline">
            <span>{formatTime(currentTime)}</span>
            <input
              type="range"
              aria-label="Seek video"
              min="0"
              max={duration || 0}
              step="0.1"
              value={Math.min(currentTime, duration || 0)}
              disabled={!duration}
              onChange={(event) => seek(Number(event.target.value))}
              style={{ "--progress": `${duration ? (currentTime / duration) * 100 : 0}%` } as React.CSSProperties}
            />
            <span>{formatTime(duration)}</span>
          </div>
        </>
      )}
    </main>
  );
}
