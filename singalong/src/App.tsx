import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import Sampler, { type SamplerTake } from "./Sampler";
import "./App.css";

declare global {
  interface Window {
    YT?: any;
    onYouTubeIframeAPIReady?: () => void;
  }
}

const BACKEND_URL = "http://127.0.0.1:8001";
const SEPARATOR_URL = `${BACKEND_URL}/api/separate`;
const YOUTUBE_AUDIO_URL = `${BACKEND_URL}/api/youtube-audio`;
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
type RecordingSegment = { peaks: number[]; offset: number; duration: number; src: string };
type LiveRecordingSegment = { peaks: number[]; offset: number; duration: number };
type LyricsResult = { id: number; trackName: string; artistName: string; albumName: string; duration: number; syncedLyrics: string };
type LyricLine = { time: number; text: string };
type YouTubeSearchResult = { id: string; title: string; channel: string; thumbnail: string; duration: number | null };

function parseSyncedLyrics(raw: string): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const timestamps = [...line.matchAll(/\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g)];
    const text = line.replace(/\[[^\]]*\]/g, "").trim();
    if (!text || !timestamps.length) continue;
    for (const timestamp of timestamps) {
      const fraction = timestamp[3] || "0";
      const secondsFraction = Number(fraction) / (10 ** fraction.length);
      lines.push({
        time: Number(timestamp[1]) * 60 + Number(timestamp[2]) + secondsFraction,
        text,
      });
    }
  }
  return lines.sort((first, second) => first.time - second.time);
}

export default function App() {
  const [url, setUrl] = useState("");
  const [youtubeResults, setYoutubeResults] = useState<YouTubeSearchResult[]>([]);
  const [youtubeSearchLoading, setYoutubeSearchLoading] = useState(false);
  const [youtubeSearchError, setYoutubeSearchError] = useState("");
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [audioUrl, setAudioUrl] = useState("");
  const [audioName, setAudioName] = useState("");
  const [lyricsQuery, setLyricsQuery] = useState("");
  const [selectedLyrics, setSelectedLyrics] = useState<LyricsResult | null>(null);
  const [lyricsLoading, setLyricsLoading] = useState(false);
  const [lyricsError, setLyricsError] = useState("");
  const [loadingYoutubeAudio, setLoadingYoutubeAudio] = useState(false);
  const [waveform, setWaveform] = useState<number[]>([]);
  const [recordingSegments, setRecordingSegments] = useState<RecordingSegment[]>([]);
  const [samplerTakes, setSamplerTakes] = useState<SamplerTake[]>([]);
  const [liveRecordingSegment, setLiveRecordingSegment] = useState<LiveRecordingSegment | null>(null);
  const [audioVolume, setAudioVolume] = useState(1);
  const [recordingVolume, setRecordingVolume] = useState(1);
  const [recording, setRecording] = useState(false);
  const [recordingError, setRecordingError] = useState("");
  const [stems, setStems] = useState<Stems | null>(null);
  const [vocalEnabled, setVocalEnabled] = useState(true);
  const [vocalVolume, setVocalVolume] = useState(1);
  const [separating, setSeparating] = useState(false);
  const [separationProgress, setSeparationProgress] = useState(0);
  const [separationMessage, setSeparationMessage] = useState("");
  const [error, setError] = useState("");
  const [youtubePlaying, setYoutubePlaying] = useState(false);
  const audioUrlRef = useRef(audioUrl);
  const youtubeInputRef = useRef<HTMLInputElement>(null);
  const shortcutStateRef = useRef({ canRecord: false, canSeparate: false, hasStems: false, canTogglePlayback: false });
  const shortcutActionsRef = useRef<{ toggleRecording?: () => void; toggleVocals?: () => void }>({});

  const playerContainerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);
  const playbackIntentRef = useRef(false);
  const resumingFromBackgroundRef = useRef(false);
  const waveformRef = useRef<HTMLCanvasElement>(null);
  const recordingWaveformRef = useRef<HTMLCanvasElement>(null);
  const samplerRecordingWaveformRef = useRef<HTMLCanvasElement>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const recordingAudioContextRef = useRef<AudioContext | null>(null);
  const recordingAnalyserRef = useRef<AnalyserNode | null>(null);
  const recordingWaveformFrameRef = useRef<number | null>(null);
  const liveRecordingPeaksRef = useRef<number[]>([]);
  const recordingActiveRef = useRef(false);
  const recordingChunksRef = useRef<Blob[]>([]);
  const nextSegmentOffsetRef = useRef<number | null>(null);
  const recordingSegmentsRef = useRef<RecordingSegment[]>([]);
  const recordingAudioRefs = useRef(new Map<string, HTMLAudioElement>());
  const selectedFileRef = useRef<File | null>(null);
  const youtubeAudioRequestRef = useRef(0);
  const youtubeSearchRequestRef = useRef(0);
  const lyricsSearchRequestRef = useRef(0);
  const loadAudioRef = useRef<(file?: File) => Promise<void>>(async () => {});
  const audioRef = useRef<HTMLAudioElement>(null);
  const vocalsRef = useRef<HTMLAudioElement>(null);
  const instrumentalRef = useRef<HTMLAudioElement>(null);
  const videoId = getYouTubeId(url);
  const lyricLines = useMemo(
    () => selectedLyrics ? parseSyncedLyrics(selectedLyrics.syncedLyrics) : [],
    [selectedLyrics],
  );
  const activeLyricIndex = (() => {
    let active = -1;
    for (let index = 0; index < lyricLines.length; index += 1) {
      if (lyricLines[index].time > currentTime) break;
      active = index;
    }
    return active;
  })();
  audioUrlRef.current = audioUrl;
  shortcutStateRef.current = {
    canRecord: Boolean(audioUrl && !loadingYoutubeAudio),
    canSeparate: Boolean(audioUrl && !stems && !separating && !loadingYoutubeAudio),
    hasStems: Boolean(stems),
    canTogglePlayback: Boolean(videoId),
  };

  const callPlayerMethod = (methodName: string, ...args: any[]) => {
    const player = playerRef.current;
    const method = player?.[methodName];
    if (typeof method === "function") return method.apply(player, args);
    return undefined;
  };

  const toggleYouTubePlayback = () => {
    const state = callPlayerMethod("getPlayerState");
    if (state === 1) {
      callPlayerMethod("pauseVideo");
      [audioRef.current, vocalsRef.current, instrumentalRef.current].forEach((track) => track?.pause());
      return;
    }

    callPlayerMethod("playVideo");
    if (audioUrlRef.current) {
      const time = callPlayerMethod("getCurrentTime") || 0;
      const tracks = stems && instrumentalRef.current
        ? [instrumentalRef.current, ...(vocalEnabled && vocalsRef.current ? [vocalsRef.current] : [])]
        : [audioRef.current];
      tracks.forEach((track) => {
        if (!track) return;
        track.currentTime = time;
        void track.play().catch(() => {});
      });
    }
  };

  const searchYouTubeTitles = async (query: string) => {
    const normalizedQuery = query.trim();
    if (!normalizedQuery || getYouTubeId(normalizedQuery)) return;
    const requestId = ++youtubeSearchRequestRef.current;
    setYoutubeSearchLoading(true);
    setYoutubeSearchError("");
    setYoutubeResults([]);
    try {
      const response = await fetch(`${BACKEND_URL}/api/youtube-search?query=${encodeURIComponent(normalizedQuery)}`);
      const result = await response.json();
      if (!response.ok) throw new Error(result.detail || "YouTube search failed.");
      if (requestId !== youtubeSearchRequestRef.current) return;
      setYoutubeResults((result.results || []) as YouTubeSearchResult[]);
      if (!result.results?.length) setYoutubeSearchError("No videos found. Try another search.");
    } catch (cause) {
      if (requestId !== youtubeSearchRequestRef.current) return;
      setYoutubeSearchError(cause instanceof Error ? cause.message : "YouTube search failed.");
    } finally {
      if (requestId === youtubeSearchRequestRef.current) setYoutubeSearchLoading(false);
    }
  };

  const selectYouTubeResult = (result: YouTubeSearchResult) => {
    setYoutubeResults([]);
    setYoutubeSearchError("");
    setUrl(`https://www.youtube.com/watch?v=${result.id}`);
  };

  const searchLyrics = useCallback(async (query: string) => {
    const normalizedQuery = query.trim().replace(/\.(mp3|m4a|aac|wav|ogg|flac|opus)$/i, "");
    const requestId = ++lyricsSearchRequestRef.current;
    setSelectedLyrics(null);
    setLyricsError("");
    if (!normalizedQuery) {
      setLyricsLoading(false);
      return;
    }

    setLyricsLoading(true);
    try {
      let results: LyricsResult[];
      try {
        const response = await fetch(`https://lrclib.net/api/search?track_name=${encodeURIComponent(normalizedQuery)}`, {
          headers: { "X-User-Agent": "SingAlong/0.1 (local lyrics search)" },
        });
        if (!response.ok) throw new Error(`LRCLIB returned HTTP ${response.status}.`);
        const result = await response.json();
        results = (Array.isArray(result) ? result : result.results || []) as LyricsResult[];
      } catch {
        const response = await fetch(`${BACKEND_URL}/api/lyrics/search?track_name=${encodeURIComponent(normalizedQuery)}`);
        const result = await response.json();
        if (!response.ok) {
          const detail = response.status === 404
            ? "The running audio service does not have the lyrics route yet. Stop and restart npm run dev so it reloads the updated backend."
            : result.detail || "Could not search for lyrics.";
          throw new Error(detail);
        }
        results = (result.results || []) as LyricsResult[];
      }
      if (requestId !== lyricsSearchRequestRef.current) return;
      const syncedResults = results.filter((result) => result.syncedLyrics);
      if (syncedResults.length) setSelectedLyrics(syncedResults[0]);
      else setLyricsError("No synchronized lyrics found. Try a shorter or more accurate song title.");
    } catch (cause) {
      if (requestId !== lyricsSearchRequestRef.current) return;
      setLyricsError(cause instanceof Error ? cause.message : "Could not search for lyrics.");
    } finally {
      if (requestId === lyricsSearchRequestRef.current) setLyricsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!videoId || !playerContainerRef.current) return;
    let disposed = false;
    let timer: number | undefined;

    setDuration(0);
    setCurrentTime(0);
    setAudioName("");
    setSelectedLyrics(null);
    setLyricsError("");
    loadYouTubeApi().then(() => {
      if (disposed || !playerContainerRef.current) return;
      playerRef.current = new window.YT!.Player(playerContainerRef.current, {
        videoId,
        playerVars: { playsinline: 1, controls: 0, disablekb: 1 },
        events: {
          onReady: (event: any) => {
            setDuration(typeof event.target.getDuration === "function" ? event.target.getDuration() || 0 : 0);
            const videoTitle = event.target.getVideoData?.().title?.trim();
            if (videoTitle) {
              setLyricsQuery(videoTitle);
              void searchLyrics(videoTitle);
            }
            const iframe = event.target.getIframe?.();
            if (iframe) iframe.tabIndex = -1;
            // Keep YouTube audible until the extracted track actually starts.
            // Its audio is the fallback when browser autoplay blocks our media element.
            if (typeof event.target.unMute === "function") event.target.unMute();
            timer = window.setInterval(() => {
              if (typeof event.target.getCurrentTime === "function") {
                setCurrentTime(event.target.getCurrentTime() || 0);
              }
              if (typeof event.target.getDuration === "function") {
                setDuration(event.target.getDuration() || 0);
              }
            }, 200);
          },
          onStateChange: (event: any) => {
            if (event.data === 1) {
              playbackIntentRef.current = true;
              resumingFromBackgroundRef.current = false;
            } else if (event.data === 0) {
              playbackIntentRef.current = false;
              pauseRecordingCapture();
            } else if (
              event.data === 2 &&
              !document.hidden &&
              document.hasFocus() &&
              !resumingFromBackgroundRef.current
            ) {
              playbackIntentRef.current = false;
            }
            if (event.data === 1) resumeRecordingCapture(event.target.getCurrentTime() || 0);
            if (event.data === 2) pauseRecordingCapture();
            setYoutubePlaying(event.data === 1);
          },
        },
      });
    });

    return () => {
      disposed = true;
      if (timer) window.clearInterval(timer);
      callPlayerMethod("destroy");
      playerRef.current = null;
      playbackIntentRef.current = false;
      resumingFromBackgroundRef.current = false;
      setYoutubePlaying(false);
    };
  }, [videoId, searchLyrics]);

  useEffect(() => {
    if (!audioName) return;
    const query = audioName.replace(/\.(mp3|m4a|aac|wav|ogg|flac|opus)$/i, "");
    setLyricsQuery(query);
    void searchLyrics(query);
    return () => { lyricsSearchRequestRef.current += 1; };
  }, [audioName, searchLyrics]);

  useEffect(() => {
    if (audioUrl) callPlayerMethod("mute");
    else callPlayerMethod("unMute");
  }, [audioUrl]);

  useEffect(() => {
    if (!videoId) {
      [audioRef.current, vocalsRef.current, instrumentalRef.current].forEach((track) => track?.pause());
    }
  }, [videoId]);

  useEffect(() => () => {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
  }, [audioUrl]);

  useEffect(() => () => {
    recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
    if (recordingWaveformFrameRef.current !== null) cancelAnimationFrame(recordingWaveformFrameRef.current);
    if (recordingAudioContextRef.current && recordingAudioContextRef.current.state !== "closed") {
      void recordingAudioContextRef.current.close();
    }
  }, []);

  useEffect(() => () => {
    recordingSegmentsRef.current.forEach((segment) => URL.revokeObjectURL(segment.src));
  }, []);

  useEffect(() => {
    audioRef.current && (audioRef.current.volume = audioVolume);
    if (instrumentalRef.current) instrumentalRef.current.volume = audioVolume;
    if (vocalsRef.current) vocalsRef.current.volume = audioVolume * vocalVolume;
  }, [audioVolume, vocalVolume, stems, audioUrl]);

  useEffect(() => {
    const syncRecordings = () => {
      const player = playerRef.current;
      const playing = Boolean(
        player && playbackIntentRef.current && callPlayerMethod("getPlayerState") === 1,
      );
      const time = playing ? callPlayerMethod("getCurrentTime") || 0 : 0;
      recordingSegments.forEach((segment) => {
        const track = recordingAudioRefs.current.get(segment.src);
        if (!track) return;
        track.volume = recordingVolume;
        if (playing && time >= segment.offset && time < segment.offset + segment.duration) {
          const segmentTime = time - segment.offset;
          if (Math.abs(track.currentTime - segmentTime) > 0.2) track.currentTime = segmentTime;
          if (track.paused) void track.play().catch(() => {});
        } else if (!track.paused) {
          track.pause();
        }
      });
    };
    syncRecordings();
    const timer = window.setInterval(syncRecordings, 100);
    return () => window.clearInterval(timer);
  }, [recordingSegments, recordingVolume, youtubePlaying]);

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
      context.fillStyle = index / waveform.length <= progress ? "#78805e" : "#b4af9e";
      context.fillRect(x, (rect.height - height) / 2, Math.max(1, barWidth - 1), height);
    });
  }, [waveform, currentTime, duration]);

  useEffect(() => {
    const canvas = recordingWaveformRef.current;
    if (!canvas || !duration) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * ratio);
    canvas.height = Math.round(rect.height * ratio);
    const context = canvas.getContext("2d");
    if (!context) return;
    context.scale(ratio, ratio);
    context.clearRect(0, 0, rect.width, rect.height);
    recordingSegments.forEach((segment) => {
      const xStart = (segment.offset / duration) * rect.width;
      const width = (segment.duration / duration) * rect.width;
      const barWidth = width / segment.peaks.length;
      segment.peaks.forEach((peak, index) => {
        const x = xStart + index * barWidth;
        const height = Math.max(2, peak * rect.height * 0.9);
        context.fillStyle = "#b2695b";
        context.fillRect(x, (rect.height - height) / 2, Math.max(1, barWidth - 1), height);
      });
    });
    if (liveRecordingSegment?.peaks.length) {
      const xStart = (liveRecordingSegment.offset / duration) * rect.width;
      const width = (liveRecordingSegment.duration / duration) * rect.width;
      const barWidth = width / liveRecordingSegment.peaks.length;
      liveRecordingSegment.peaks.forEach((peak, index) => {
        const x = xStart + index * barWidth;
        const height = Math.max(2, peak * rect.height * 0.9);
        context.fillStyle = "#cf8a7a";
        context.fillRect(x, (rect.height - height) / 2, Math.max(1, barWidth - 1), height);
      });
    }
  }, [recordingSegments, liveRecordingSegment, duration]);

  useEffect(() => {
    const canvas = samplerRecordingWaveformRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * ratio);
    canvas.height = Math.round(rect.height * ratio);
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, rect.width, rect.height);
    if (!duration) return;
    samplerTakes.forEach((take) => {
      if (!take.peaks.length) return;
      const xStart = (take.offset / duration) * rect.width;
      const width = (take.duration / duration) * rect.width;
      const barWidth = width / take.peaks.length;
      take.peaks.forEach((peak, index) => {
        const height = Math.max(2, peak * rect.height * 0.88);
        context.fillStyle = "#73865f";
        context.fillRect(xStart + index * barWidth, (rect.height - height) / 2, Math.max(1, barWidth - 1), height);
      });
    });
    context.fillStyle = "#b2695b";
    context.fillRect((currentTime / duration) * rect.width, 0, 2, rect.height);
  }, [samplerTakes, currentTime, duration]);

  const stopLiveWaveform = () => {
    if (recordingWaveformFrameRef.current !== null) {
      cancelAnimationFrame(recordingWaveformFrameRef.current);
      recordingWaveformFrameRef.current = null;
    }
    setLiveRecordingSegment(null);
  };

  const stopRecordingMonitor = () => {
    stopLiveWaveform();
    recordingAnalyserRef.current = null;
    const context = recordingAudioContextRef.current;
    recordingAudioContextRef.current = null;
    if (context && context.state !== "closed") void context.close();
  };

  const startRecordingSegment = (offset: number) => {
    const stream = recordingStreamRef.current;
    if (!stream || !recordingActiveRef.current) return;
    const recorder = new MediaRecorder(stream);
    recorderRef.current = recorder;
    const segmentOffset = offset;
    liveRecordingPeaksRef.current = [];
    const startedAt = performance.now();
    let lastSampleAt = 0;
    setLiveRecordingSegment({ peaks: [], offset: segmentOffset, duration: 0 });
    recordingChunksRef.current = [];
    recorder.ondataavailable = (event) => {
      if (event.data.size) recordingChunksRef.current.push(event.data);
    };
    recorder.onstop = async () => {
      const blob = new Blob(recordingChunksRef.current, { type: recorder.mimeType || "audio/webm" });
      const nextOffset = nextSegmentOffsetRef.current;
      nextSegmentOffsetRef.current = null;
      if (recordingActiveRef.current && nextOffset !== null && callPlayerMethod("getPlayerState") === 1) {
        startRecordingSegment(nextOffset);
      } else if (!recordingActiveRef.current) {
        recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
        recordingStreamRef.current = null;
        stopRecordingMonitor();
        setRecording(false);
      }

      if (recorderRef.current === recorder) stopLiveWaveform();

      if (blob.size) {
        const src = URL.createObjectURL(blob);
        try {
          const audioContext = new AudioContext();
          const decoded = await audioContext.decodeAudioData(await blob.arrayBuffer());
          await audioContext.close();
          const samples = decoded.getChannelData(0);
          const count = Math.min(900, Math.max(1, Math.floor(samples.length / 256)));
          const bucketSize = Math.max(1, Math.floor(samples.length / count));
          const peaks = Array.from({ length: count }, (_, bucket) => {
            let peak = 0;
            for (let i = bucket * bucketSize; i < Math.min(samples.length, (bucket + 1) * bucketSize); i += 1) {
              peak = Math.max(peak, Math.abs(samples[i]));
            }
            return peak;
          });
          const segment = {
            peaks,
            offset: segmentOffset,
            duration: decoded.duration,
            src,
          };
          setRecordingSegments((segments) => {
            const next = [...segments, segment];
            recordingSegmentsRef.current = next;
            return next;
          });
        } catch {
          URL.revokeObjectURL(src);
          setRecordingError("A recording segment could not be added to the waveform.");
        }
      }
    };
    recorder.start();

    const sampleWaveform = (timestamp: number) => {
      if (recorderRef.current !== recorder || recorder.state !== "recording") return;
      const analyser = recordingAnalyserRef.current;
      if (analyser && timestamp - lastSampleAt >= 80) {
        const samples = new Uint8Array(analyser.fftSize);
        analyser.getByteTimeDomainData(samples);
        let peak = 0;
        for (const sample of samples) peak = Math.max(peak, Math.abs(sample - 128) / 128);
        liveRecordingPeaksRef.current.push(peak);
        if (liveRecordingPeaksRef.current.length > 1400) {
          liveRecordingPeaksRef.current = liveRecordingPeaksRef.current.reduce<number[]>((compressed, value, index, peaks) => {
            if (index % 2 === 0) compressed.push(Math.max(value, peaks[index + 1] || 0));
            return compressed;
          }, []);
        }
        setLiveRecordingSegment({
          peaks: [...liveRecordingPeaksRef.current],
          offset: segmentOffset,
          duration: (performance.now() - startedAt) / 1000,
        });
        lastSampleAt = timestamp;
      }
      recordingWaveformFrameRef.current = requestAnimationFrame(sampleWaveform);
    };
    recordingWaveformFrameRef.current = requestAnimationFrame(sampleWaveform);
  };

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
        const instrumental = instrumentalRef.current;
        const vocals = vocalsRef.current;
        const tracks = stems
          ? [instrumental, ...(vocalEnabled ? [vocals] : [])]
          : [audioRef.current];

        if (stems) {
          audioRef.current?.pause();
          if (vocalsRef.current) vocalsRef.current.volume = audioVolume * vocalVolume;
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
  }, [audioUrl, stems, vocalEnabled, vocalVolume, audioVolume, youtubePlaying, videoId]);

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
    if (recordingActiveRef.current) {
      const isPlaying = callPlayerMethod("getPlayerState") === 1;
      nextSegmentOffsetRef.current = isPlaying ? time : null;
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      else if (isPlaying) startRecordingSegment(time);
    }
    setCurrentTime(time);
    callPlayerMethod("seekTo", time, true);
    [audioRef.current, vocalsRef.current, instrumentalRef.current].forEach((track) => {
      if (track) track.currentTime = time;
    });
  };

  const loadAudio = async (file?: File) => {
    if (!file) return;
    recordingSegmentsRef.current.forEach((segment) => URL.revokeObjectURL(segment.src));
    recordingSegmentsRef.current = [];
    recordingAudioRefs.current.clear();
    if (recordingActiveRef.current) {
      recordingActiveRef.current = false;
      nextSegmentOffsetRef.current = null;
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    }
    setRecordingSegments([]);
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
  loadAudioRef.current = loadAudio;

  useEffect(() => {
    if (!videoId) {
      setLoadingYoutubeAudio(false);
      return;
    }

    const requestId = ++youtubeAudioRequestRef.current;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoadingYoutubeAudio(true);
      setError("");
      try {
        const response = await fetch(YOUTUBE_AUDIO_URL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ url: `https://www.youtube.com/watch?v=${videoId}` }),
          signal: controller.signal,
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.detail || "Could not extract audio from this YouTube video.");

        const audioResponse = await fetch(`${BACKEND_URL}${result.audio}`, { signal: controller.signal });
        if (!audioResponse.ok) throw new Error("The extracted audio could not be loaded.");
        const audioBlob = await audioResponse.blob();
        if (requestId !== youtubeAudioRequestRef.current) return;

        const fileName = `${String(result.title || "YouTube audio").replace(/[\\/:*?"<>|]/g, "_")}.mp3`;
        await loadAudioRef.current(new File([audioBlob], fileName, { type: "audio/mpeg" }));
      } catch (cause) {
        if (controller.signal.aborted || requestId !== youtubeAudioRequestRef.current) return;
        setError(
          cause instanceof TypeError
            ? "Can't reach the local audio service. Start it from the backend folder with: .\\.venv\\Scripts\\Activate.ps1, then python -m uvicorn app:app --port 8001."
            : cause instanceof Error
              ? cause.message
              : "Could not load audio from this YouTube video.",
        );
      } finally {
        if (requestId === youtubeAudioRequestRef.current) setLoadingYoutubeAudio(false);
      }
    }, 350);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [videoId]);

  useEffect(() => {
    const handlePaste = (event: ClipboardEvent) => {
      if (event.target === youtubeInputRef.current) return;
      const pastedText = event.clipboardData?.getData("text/plain").trim();
      if (!pastedText || !getYouTubeId(pastedText)) return;
      event.preventDefault();
      setUrl(pastedText);
    };

    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, []);

  const toggleRecording = async () => {
    setRecordingError("");
    if (recordingActiveRef.current) {
      recordingActiveRef.current = false;
      nextSegmentOffsetRef.current = null;
      if (recorderRef.current?.state === "recording") recorderRef.current.stop();
      else {
        recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
        recordingStreamRef.current = null;
        stopRecordingMonitor();
        setRecording(false);
      }
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setRecordingError("Audio recording is not supported by this browser.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordingStreamRef.current = stream;
      const audioContext = new AudioContext();
      recordingAudioContextRef.current = audioContext;
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 1024;
      recordingAnalyserRef.current = analyser;
      audioContext.createMediaStreamSource(stream).connect(analyser);
      await audioContext.resume();
      recordingActiveRef.current = true;
      setRecording(true);
      if (callPlayerMethod("getPlayerState") === 1) startRecordingSegment(currentTime);
    } catch {
      recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
      recordingStreamRef.current = null;
      stopRecordingMonitor();
      setRecordingError("Microphone access was denied or unavailable. Allow microphone access and try again.");
    }
  };

  function pauseRecordingCapture() {
    nextSegmentOffsetRef.current = null;
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
  }

  function resumeRecordingCapture(offset: number) {
    if (
      recordingActiveRef.current &&
      recordingStreamRef.current &&
      recorderRef.current?.state !== "recording"
    ) {
      nextSegmentOffsetRef.current = null;
      startRecordingSegment(offset);
    }
  }

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
        vocals: `${BACKEND_URL}${result.vocals}`,
        instrumental: `${BACKEND_URL}${result.instrumental}`,
      });
    } catch (cause) {
      setError(
        cause instanceof TypeError
          ? "Can't reach the local vocal separation service. Start it from the backend folder with: .\\.venv\\Scripts\\Activate.ps1, then python -m uvicorn app:app --port 8001."
          : cause instanceof Error
            ? cause.message
            : "Vocal separation failed. Check that the local service is running.",
      );
    } finally {
      setSeparating(false);
    }
  };

  shortcutActionsRef.current = {
    toggleRecording: () => void toggleRecording(),
    toggleVocals: () => {
      if (shortcutStateRef.current.hasStems) setVocalEnabled((enabled) => !enabled);
      else if (shortcutStateRef.current.canSeparate) void separateVocals();
    },
  };

  useEffect(() => {
    const handleShortcut = (event: globalThis.KeyboardEvent) => {
      if (event.target === youtubeInputRef.current) return;
      if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
      const key = event.key.toLowerCase();
      if (key === "r" && shortcutStateRef.current.canRecord) {
        event.preventDefault();
        shortcutActionsRef.current.toggleRecording?.();
      } else if (key === "v" && (shortcutStateRef.current.hasStems || shortcutStateRef.current.canSeparate)) {
        event.preventDefault();
        shortcutActionsRef.current.toggleVocals?.();
      } else if (key === "k" && shortcutStateRef.current.canTogglePlayback) {
        event.preventDefault();
        toggleYouTubePlayback();
      }
    };

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  const moveWithKeyboard = (event: KeyboardEvent<HTMLCanvasElement>) => {
    if (!duration) return;
    if (event.key === "ArrowRight") seek(Math.min(duration, currentTime + 5));
    if (event.key === "ArrowLeft") seek(Math.max(0, currentTime - 5));
  };

  const lyricWindowStart = Math.max(0, Math.min(
    activeLyricIndex < 0 ? 0 : activeLyricIndex - 2,
    Math.max(0, lyricLines.length - 5),
  ));

  return (
    <main className={`app${videoId ? " has-video" : ""}`}>
      <div className={`youtube-input-shell${videoId ? " has-video" : ""}`}>
        <input
          ref={youtubeInputRef}
          className={`youtube-input${videoId ? " is-collapsed" : ""}`}
          type="text"
          aria-label="YouTube video link"
          placeholder="paste a YouTube link or search a title (press Enter)"
          value={url}
          onChange={(event) => { youtubeSearchRequestRef.current += 1; setYoutubeSearchLoading(false); setUrl(event.target.value); setYoutubeResults([]); setYoutubeSearchError(""); }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !getYouTubeId(url)) {
              event.preventDefault();
              void searchYouTubeTitles(url);
            }
          }}
          autoComplete="url"
        />
        {videoId && duration > 0 && <div className="youtube-input-progress" role="progressbar" aria-label="Song progress" aria-valuemin={0} aria-valuemax={Math.floor(duration)} aria-valuenow={Math.floor(currentTime)}>
          <span style={{ width: `${Math.max(0, Math.min(100, (currentTime / duration) * 100))}%` }} />
        </div>}
      </div>
        {youtubeSearchLoading && <p className="youtube-search-message" role="status">Searching YouTube…</p>}
        {youtubeSearchError && <p className="youtube-search-message youtube-search-error" role="status">{youtubeSearchError}</p>}
        {youtubeResults.length > 0 && <ul className="youtube-search-results" aria-label="YouTube search results">
          {youtubeResults.map((result) => <li key={result.id}>
            <button type="button" onClick={() => selectYouTubeResult(result)}>
              {result.thumbnail && <img src={result.thumbnail} alt="" />}
              <span className="youtube-result-text"><strong>{result.title}</strong><span>{result.channel}{result.duration ? ` · ${formatTime(result.duration)}` : ""}</span></span>
            </button>
          </li>)}
        </ul>}

      {videoId && (
        <>
          <div className="player-controls-row">
          <div
            className="youtube-player"
            role="button"
            tabIndex={0}
            aria-label="Toggle video playback"
            title="Click to play or pause (K)"
            onClick={toggleYouTubePlayback}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                toggleYouTubePlayback();
              }
            }}
          >
            <div ref={playerContainerRef} />
          </div>
            <div className="audio-actions">
              {audioName && <span className="audio-name">{audioName}</span>}
              <button
                className={`action-button record-button${recording ? " is-recording" : ""}`}
                onClick={() => void toggleRecording()}
                disabled={!audioUrl || loadingYoutubeAudio}
                aria-label={recording ? "Stop recording" : "Start recording"}
                aria-pressed={recording}
                title={recording ? "Stop recording (R)" : "Start recording (R) to capture microphone and sampler"}
              >
                <span className="record-button-indicator" aria-hidden="true" />
              </button>
              {audioUrl && (
                <>
                  <button
                    className={`action-button separate-vocals-button${stems ? ` vocal-toggle-button${vocalEnabled ? " vocals-on" : " vocals-off"}` : ""}`}
                    onClick={() => stems ? setVocalEnabled((enabled) => !enabled) : void separateVocals()}
                    disabled={!stems && (separating || loadingYoutubeAudio)}
                    title={stems ? `Turn vocals ${vocalEnabled ? "off" : "on"} (V)` : separating ? "Separating vocals" : "Separate vocals"}
                    aria-label={stems ? `Turn vocals ${vocalEnabled ? "off" : "on"}` : separating ? "Separating vocals" : "Separate vocals"}
                    aria-pressed={stems ? vocalEnabled : undefined}
                  >
                    <svg className="separate-vocals-icon" viewBox="0 0 64 64" aria-hidden="true" focusable="false">
                      <path className="separate-vocals-profile" d="M12 56h22v-8c5-3 9-8 10-14l5-2-5-4 5-4-6-4C42 12 35 6 24 6 13 6 6 14 6 25c0 7 3 12 8 17 3 3 2 9-2 14Z" />
                      {!stems && <path className="separate-vocals-zigzag" d="m47 15-5 6 4 4-5 5 4 4-5 6 4 4-5 6" />}
                      {stems && <path className="vocal-toggle-sound" d="m53 23 7-7M54 32h9m-10 9 7 7" />}
                    </svg>
                    <span className="vocal-button-state" aria-hidden="true">{stems ? (vocalEnabled ? "ON" : "OFF") : separating ? "…" : ""}</span>
                  </button>
                  {stems && <label className="vocal-volume">
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={Math.round(vocalVolume * 100)}
                      aria-label="Vocal volume"
                      onChange={(event) => setVocalVolume(Number(event.target.value) / 100)}
                    />
                    <span className="vocal-volume-caption">
                      <span>Vocal volume</span>
                      <span>{Math.round(vocalVolume * 100)}%</span>
                    </span>
                  </label>}
                </>
              )}
            </div>
          </div>
          <input
            className="youtube-seekbar"
            type="range"
            min="0"
            max={duration || 0}
            step="0.1"
            value={duration ? Math.min(currentTime, duration) : 0}
            aria-label="Seek through video"
            disabled={!duration}
            onChange={(event) => seek(Number(event.target.value))}
            style={{ "--seek-progress": `${duration ? Math.max(0, Math.min(100, (currentTime / duration) * 100)) : 0}%` } as CSSProperties & { "--seek-progress": string }}
          />
          {audioName && <section className="lyrics-panel" aria-label="Synchronized lyrics">
            {!selectedLyrics && <>
              <form className="lyrics-search" onSubmit={(event) => { event.preventDefault(); void searchLyrics(lyricsQuery); }}>
                <input aria-label="Search lyrics by song title" value={lyricsQuery} onChange={(event) => setLyricsQuery(event.target.value)} placeholder="Search by song title" />
                <button type="submit" disabled={lyricsLoading}>{lyricsLoading ? "Searching…" : "Search"}</button>
              </form>
              {lyricsError && <p className="lyrics-message" role="status">{lyricsError}</p>}
            </>}
            {selectedLyrics && <div className="lyrics-lines" aria-label="Lyrics synchronized to song playback" aria-live="off">
              {lyricLines.slice(lyricWindowStart, lyricWindowStart + 5).map((line, visibleIndex) => {
                const lineIndex = lyricWindowStart + visibleIndex;
                return <p key={`${line.time}-${lineIndex}`} className={`lyrics-line${lineIndex === activeLyricIndex ? " is-active" : ""}`} aria-current={lineIndex === activeLyricIndex ? "true" : undefined}>{line.text}</p>;
              })}
            </div>}
            <p className="lyrics-credit">Synchronized lyrics via LRCLIB</p>
          </section>}
          <div className="timeline-times"><span>{formatTime(currentTime)}</span><span>{formatTime(duration)}</span></div>
          <div className="timeline-row">
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
            <label className="timeline-volume">
              <input type="range" min="0" max="100" value={Math.round(audioVolume * 100)} aria-label="Uploaded audio volume" onChange={(event) => setAudioVolume(Number(event.target.value) / 100)} />
              <span>{Math.round(audioVolume * 100)}%</span>
            </label>
          </div>

          <div className="timeline-row">
            <canvas ref={recordingWaveformRef} className={`waveform recording-waveform${liveRecordingSegment ? " recording-waveform-live" : ""}`} role="img" aria-label={liveRecordingSegment ? "Your recording waveform updating live" : "Your recording waveform"} />
            <label className="timeline-volume">
              <input type="range" min="0" max="100" value={Math.round(recordingVolume * 100)} aria-label="Recording volume" onChange={(event) => setRecordingVolume(Number(event.target.value) / 100)} />
              <span>{Math.round(recordingVolume * 100)}%</span>
            </label>
          </div>

          <div className="sampler-take-heading">
            <span>Instrument timeline {recording ? "· recording" : samplerTakes.length ? `· ${samplerTakes.length} sound${samplerTakes.length === 1 ? "" : "s"}` : "· press R, then play the sampler"}</span>
            {samplerTakes.length > 0 && <button type="button" onClick={() => setSamplerTakes([])}>Clear</button>}
          </div>
          <div className="timeline-row">
            <canvas ref={samplerRecordingWaveformRef} className={`waveform sampler-take-waveform${recording ? " sampler-take-recording" : ""}`} role="img" aria-label="Sampler instrument recording waveform" />
          </div>

          <Sampler
            enabled={Boolean(videoId)}
            currentTime={currentTime}
            recording={recording}
            playing={youtubePlaying}
            takes={samplerTakes}
            setTakes={setSamplerTakes}
          />

          {separating && (
            <div className="separation-progress">
              <div className="progress-label">
                <span>{separationMessage}</span>
                <span>{separationProgress}%</span>
              </div>
              <progress value={separationProgress} max="100" aria-label="Vocal separation progress" />
            </div>
          )}
          {loadingYoutubeAudio && <p className="audio-note">Extracting audio from YouTube…</p>}
          {error && <p className="error-message">{error}</p>}
          {recordingError && <p className="error-message">{recordingError}</p>}

          {audioUrl && <audio ref={audioRef} src={audioUrl} preload="auto" />}
          {stems && (
            <>
              <audio ref={vocalsRef} src={stems.vocals} preload="auto" />
              <audio ref={instrumentalRef} src={stems.instrumental} preload="auto" />
            </>
          )}
          {recordingSegments.map((segment) => (
            <audio
              key={segment.src}
              ref={(element) => {
                if (element) recordingAudioRefs.current.set(segment.src, element);
                else recordingAudioRefs.current.delete(segment.src);
              }}
              src={segment.src}
              preload="auto"
            />
          ))}
        </>
      )}
    </main>
  );
}
