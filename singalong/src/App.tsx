import { useEffect, useRef, useState } from "react";
import "./App.css";

type VoiceSegment = {
  id: string;
  startTime: number;
  duration: number;
  blob: Blob;
  url: string;
  audioBuffer?: AudioBuffer;
};

function App() {
  const originalAudioRef = useRef<HTMLAudioElement | null>(null);

  const originalCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const voiceCanvasRef = useRef<HTMLCanvasElement | null>(null);

  const audioContextRef = useRef<AudioContext | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const microphoneStreamRef = useRef<MediaStream | null>(null);

  const voiceAudioElementsRef = useRef<
    Map<string, HTMLAudioElement>
  >(new Map());

  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);

  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isRecording, setIsRecording] = useState(false);

  const [originalMuted, setOriginalMuted] = useState(false);
  const [voiceMuted, setVoiceMuted] = useState(false);

  const [voiceSegments, setVoiceSegments] = useState<
    VoiceSegment[]
  >([]);

  const recordingStartTimeRef = useRef(0);
  const recordingChunksRef = useRef<Blob[]>([]);

  // -----------------------------
  // FORMAT TIME
  // -----------------------------

  const formatTime = (seconds: number) => {
    if (!Number.isFinite(seconds)) {
      return "0:00";
    }

    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);

    return `${minutes}:${remainingSeconds
      .toString()
      .padStart(2, "0")}`;
  };

  // -----------------------------
  // LOAD AUDIO
  // -----------------------------

  const handleAudioUpload = async (
    event: React.ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];

    if (!file) {
      return;
    }

    originalAudioRef.current?.pause();

    setIsPlaying(false);
    setCurrentTime(0);

    setVoiceSegments([]);

    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
    }

    const newUrl = URL.createObjectURL(file);

    setAudioFile(file);
    setAudioUrl(newUrl);

    if (audioContextRef.current) {
      await audioContextRef.current.close();
    }

    const audioContext = new AudioContext();

    audioContextRef.current = audioContext;

    const arrayBuffer = await file.arrayBuffer();

    try {
      const audioBuffer =
        await audioContext.decodeAudioData(arrayBuffer);

      setDuration(audioBuffer.duration);

      requestAnimationFrame(() => {
        drawOriginalWaveform(audioBuffer);
        drawVoiceWaveform([]);
      });
    } catch (error) {
      console.error(error);
      alert("Could not decode this audio file.");
    }
  };

  // -----------------------------
  // ORIGINAL WAVEFORM
  // -----------------------------

  const drawOriginalWaveform = (
    audioBuffer: AudioBuffer,
  ) => {
    const canvas = originalCanvasRef.current;

    if (!canvas) {
      return;
    }

    const rect = canvas.getBoundingClientRect();

    const dpr = window.devicePixelRatio || 1;

    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;

    const ctx = canvas.getContext("2d");

    if (!ctx) {
      return;
    }

    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = rect.height;

    ctx.clearRect(0, 0, width, height);

    const data = audioBuffer.getChannelData(0);

    const middle = height / 2;

    const pixelsPerSecond =
      width / audioBuffer.duration;

    for (let x = 0; x < width; x++) {
      const startTime = x / pixelsPerSecond;
      const endTime = (x + 1) / pixelsPerSecond;

      const startIndex = Math.floor(
        startTime * audioBuffer.sampleRate,
      );

      const endIndex = Math.min(
        data.length,
        Math.floor(
          endTime * audioBuffer.sampleRate,
        ),
      );

      let min = 1;
      let max = -1;

      for (let i = startIndex; i < endIndex; i++) {
        const value = data[i];

        min = Math.min(min, value);
        max = Math.max(max, value);
      }

      const amplitude = Math.max(
        2,
        ((max - min) / 2) * height * 0.8,
      );

      ctx.fillStyle = "#6366f1";

      ctx.fillRect(
        x,
        middle - amplitude,
        1,
        amplitude * 2,
      );
    }
  };

  // -----------------------------
  // VOICE WAVEFORM
  // -----------------------------

  const drawVoiceWaveform = (
    segments: VoiceSegment[],
  ) => {
    const canvas = voiceCanvasRef.current;

    if (!canvas) {
      return;
    }

    const rect = canvas.getBoundingClientRect();

    const dpr = window.devicePixelRatio || 1;

    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;

    const ctx = canvas.getContext("2d");

    if (!ctx) {
      return;
    }

    ctx.scale(dpr, dpr);

    const width = rect.width;
    const height = rect.height;

    ctx.clearRect(0, 0, width, height);

    if (duration <= 0) {
      return;
    }

    const middle = height / 2;

    for (const segment of segments) {
      if (!segment.audioBuffer) {
        continue;
      }

      const data =
        segment.audioBuffer.getChannelData(0);

      const startX =
        (segment.startTime / duration) * width;

      const segmentWidth =
        (segment.duration / duration) * width;

      if (segmentWidth <= 1) {
        continue;
      }

      for (let x = 0; x < segmentWidth; x++) {
        const startIndex = Math.floor(
          (x / segmentWidth) * data.length,
        );

        const endIndex = Math.min(
          data.length,
          Math.floor(
            ((x + 1) / segmentWidth) *
              data.length,
          ),
        );

        let min = 1;
        let max = -1;

        for (
          let i = startIndex;
          i < endIndex;
          i++
        ) {
          const value = data[i];

          min = Math.min(min, value);
          max = Math.max(max, value);
        }

        const amplitude = Math.max(
          2,
          ((max - min) / 2) * height * 0.8,
        );

        ctx.fillStyle = "#22c55e";

        ctx.fillRect(
          startX + x,
          middle - amplitude,
          1,
          amplitude * 2,
        );
      }
    }
  };

  // -----------------------------
  // PLAY VOICE SEGMENTS
  // -----------------------------

  const playVoiceSegments = (
    time: number,
  ) => {
    if (voiceMuted) {
      return;
    }

    for (const segment of voiceSegments) {
      const segmentStart = segment.startTime;
      const segmentEnd =
        segment.startTime + segment.duration;

      if (
        time >= segmentStart &&
        time < segmentEnd
      ) {
        let audio =
          voiceAudioElementsRef.current.get(
            segment.id,
          );

        if (!audio) {
          audio = new Audio(segment.url);

          audio.preload = "auto";

          voiceAudioElementsRef.current.set(
            segment.id,
            audio,
          );
        }

        const offset =
          time - segment.startTime;

        if (
          Math.abs(audio.currentTime - offset) >
          0.15
        ) {
          audio.currentTime = offset;
        }

        audio.volume = voiceMuted ? 0 : 1;

        if (audio.paused) {
          audio.play().catch(() => {});
        }
      }
    }
  };

  // -----------------------------
  // STOP VOICE
  // -----------------------------

  const stopAllVoiceAudio = () => {
    voiceAudioElementsRef.current.forEach(
      (audio) => {
        audio.pause();
      },
    );
  };

  // -----------------------------
  // PLAY / PAUSE
  // -----------------------------

  const togglePlayback = async () => {
    const audio = originalAudioRef.current;

    if (!audio) {
      return;
    }

    if (isPlaying) {
      audio.pause();

      stopAllVoiceAudio();

      setIsPlaying(false);

      return;
    }

    try {
      if (audioContextRef.current?.state === "suspended") {
        await audioContextRef.current.resume();
      }

      await audio.play();

      setIsPlaying(true);
    } catch (error) {
      console.error(error);
    }
  };

  // -----------------------------
  // SEEK
  // -----------------------------

  const handleWaveformClick = (
    event: React.MouseEvent<HTMLCanvasElement>,
  ) => {
    if (duration <= 0) {
      return;
    }

    const canvas = event.currentTarget;

    const rect = canvas.getBoundingClientRect();

    const x = event.clientX - rect.left;

    const percentage =
      Math.max(
        0,
        Math.min(1, x / rect.width),
      );

    const newTime = percentage * duration;

    if (originalAudioRef.current) {
      originalAudioRef.current.currentTime =
        newTime;
    }

    voiceAudioElementsRef.current.forEach(
      (audio, id) => {
        const segment = voiceSegments.find(
          (item) => item.id === id,
        );

        if (!segment) {
          return;
        }

        const segmentEnd =
          segment.startTime +
          segment.duration;

        if (
          newTime >= segment.startTime &&
          newTime < segmentEnd
        ) {
          audio.currentTime =
            newTime - segment.startTime;
        } else {
          audio.pause();
        }
      },
    );

    setCurrentTime(newTime);
  };

  // -----------------------------
  // RECORD
  // -----------------------------

  const startRecording = async () => {
    if (!audioUrl) {
      alert("Upload an audio file first.");
      return;
    }

    if (isRecording) {
      return;
    }

    try {
      const stream =
        await navigator.mediaDevices.getUserMedia({
          audio: true,
        });

      microphoneStreamRef.current = stream;

      const recorder = new MediaRecorder(stream);

      mediaRecorderRef.current = recorder;

      recordingChunksRef.current = [];

      recordingStartTimeRef.current =
        currentTime;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordingChunksRef.current.push(
            event.data,
          );
        }
      };

      recorder.onstop = async () => {
        const blob = new Blob(
          recordingChunksRef.current,
          {
            type:
              recorder.mimeType ||
              "audio/webm",
          },
        );

        const url = URL.createObjectURL(blob);

        const audioContext =
          audioContextRef.current;

        if (!audioContext) {
          return;
        }

        try {
          const arrayBuffer =
            await blob.arrayBuffer();

          const audioBuffer =
            await audioContext.decodeAudioData(
              arrayBuffer,
            );

          const segment: VoiceSegment = {
            id: crypto.randomUUID(),

            startTime:
              recordingStartTimeRef.current,

            duration: audioBuffer.duration,

            blob,

            url,

            audioBuffer,
          };

          setVoiceSegments(
            (previous) => [
              ...previous,
              segment,
            ],
          );
        } catch (error) {
          console.error(
            "Could not decode recording:",
            error,
          );
        }
      };

      recorder.start();

      setIsRecording(true);
    } catch (error) {
      console.error(error);

      alert(
        "Microphone access was denied or is not available.",
      );
    }
  };

  // -----------------------------
  // STOP RECORDING
  // -----------------------------

  const stopRecording = () => {
    const recorder =
      mediaRecorderRef.current;

    if (!recorder || !isRecording) {
      return;
    }

    recorder.stop();

    microphoneStreamRef.current
      ?.getTracks()
      .forEach((track) => track.stop());

    microphoneStreamRef.current = null;

    setIsRecording(false);
  };

  // -----------------------------
  // TIME UPDATE
  // -----------------------------

  useEffect(() => {
    const audio =
      originalAudioRef.current;

    if (!audio) {
      return;
    }

    const handleTimeUpdate = () => {
      const time = audio.currentTime;

      setCurrentTime(time);

      if (isPlaying) {
        playVoiceSegments(time);
      }
    };

    const handleLoadedMetadata = () => {
      if (Number.isFinite(audio.duration)) {
        setDuration(audio.duration);
      }
    };

    const handleEnded = () => {
      stopAllVoiceAudio();

      setIsPlaying(false);

      setCurrentTime(0);
    };

    audio.addEventListener(
      "timeupdate",
      handleTimeUpdate,
    );

    audio.addEventListener(
      "loadedmetadata",
      handleLoadedMetadata,
    );

    audio.addEventListener(
      "ended",
      handleEnded,
    );

    return () => {
      audio.removeEventListener(
        "timeupdate",
        handleTimeUpdate,
      );

      audio.removeEventListener(
        "loadedmetadata",
        handleLoadedMetadata,
      );

      audio.removeEventListener(
        "ended",
        handleEnded,
      );
    };
  }, [
    audioUrl,
    isPlaying,
    voiceSegments,
    voiceMuted,
  ]);

  // -----------------------------
  // MUTE ORIGINAL
  // -----------------------------

  useEffect(() => {
    if (originalAudioRef.current) {
      originalAudioRef.current.muted =
        originalMuted;
    }
  }, [originalMuted]);

  // -----------------------------
  // MUTE VOICE
  // -----------------------------

  useEffect(() => {
    voiceAudioElementsRef.current.forEach(
      (audio) => {
        audio.muted = voiceMuted;
      },
    );
  }, [voiceMuted]);

  // -----------------------------
  // REDRAW WAVEFORM
  // -----------------------------

  useEffect(() => {
    drawVoiceWaveform(voiceSegments);
  }, [voiceSegments, duration]);

  // -----------------------------
  // DELETE RECORDING
  // -----------------------------

  const deleteSegment = (id: string) => {
    const audio =
      voiceAudioElementsRef.current.get(id);

    if (audio) {
      audio.pause();

      voiceAudioElementsRef.current.delete(id);
    }

    setVoiceSegments((previous) => {
      const segment = previous.find(
        (item) => item.id === id,
      );

      if (segment) {
        URL.revokeObjectURL(segment.url);
      }

      return previous.filter(
        (item) => item.id !== id,
      );
    });
  };

  // -----------------------------
  // UI
  // -----------------------------

  return (
    <div className="app">
      <header className="header">
        <div>
          <h1>SingAlong</h1>

          <p>
            Practice your voice over any audio track.
          </p>
        </div>

        <label className="upload-button">
          <span>＋</span>
          Upload Audio

          <input
            type="file"
            accept="audio/*"
            onChange={handleAudioUpload}
            hidden
          />
        </label>
      </header>

      {!audioFile && (
        <main className="empty-state">
          <div className="empty-icon">♫</div>

          <h2>Start a new session</h2>

          <p>
            Upload an MP3 or WAV file to begin.
          </p>

          <label className="primary-button">
            Choose Audio

            <input
              type="file"
              accept="audio/*"
              onChange={handleAudioUpload}
              hidden
            />
          </label>
        </main>
      )}

      {audioFile && (
        <main className="workspace">
          <div className="track-header">
            <div>
              <div className="track-title">
                {audioFile.name}
              </div>

              <div className="track-subtitle">
                {formatTime(duration)}
              </div>
            </div>
          </div>

          {/* ORIGINAL */}

          <section className="track">
            <div className="track-label">
              <div>
                <strong>Original</strong>

                <span>
                  {originalMuted
                    ? "Muted"
                    : "Playing"}
                </span>
              </div>

              <button
                className="mute-button"
                onClick={() =>
                  setOriginalMuted(
                    (value) => !value,
                  )
                }
              >
                {originalMuted
                  ? "🔇"
                  : "🔊"}
              </button>
            </div>

            <canvas
              ref={originalCanvasRef}
              className="waveform"
              onClick={handleWaveformClick}
            />
          </section>

          {/* VOICE */}

          <section className="track">
            <div className="track-label">
              <div>
                <strong>My Voice</strong>

                <span>
                  {voiceSegments.length === 0
                    ? "No recording"
                    : `${voiceSegments.length} recording${
                        voiceSegments.length >
                        1
                          ? "s"
                          : ""
                      }`}
                </span>
              </div>

              <button
                className="mute-button"
                onClick={() =>
                  setVoiceMuted(
                    (value) => !value,
                  )
                }
              >
                {voiceMuted
                  ? "🔇"
                  : "🔊"}
              </button>
            </div>

            <canvas
              ref={voiceCanvasRef}
              className="waveform voice-waveform"
              onClick={handleWaveformClick}
            />

            {voiceSegments.length > 0 && (
              <div className="recording-list">
                {voiceSegments.map(
                  (segment, index) => (
                    <div
                      className="recording-item"
                      key={segment.id}
                    >
                      <div>
                        <strong>
                          Recording{" "}
                          {index + 1}
                        </strong>

                        <span>
                          Starts at{" "}
                          {formatTime(
                            segment.startTime,
                          )}
                        </span>
                      </div>

                      <button
                        className="delete-button"
                        onClick={() =>
                          deleteSegment(
                            segment.id,
                          )
                        }
                      >
                        Delete
                      </button>
                    </div>
                  ),
                )}
              </div>
            )}
          </section>

          {/* CONTROLS */}

          <section className="controls">
            <div className="time">
              {formatTime(currentTime)}
            </div>

            <button
              className="play-button"
              onClick={togglePlayback}
            >
              {isPlaying ? "❚❚" : "▶"}
            </button>

            {!isRecording ? (
              <button
                className="record-button"
                onClick={startRecording}
              >
                <span className="record-dot" />
                Record
              </button>
            ) : (
              <button
                className="stop-button"
                onClick={stopRecording}
              >
                <span className="stop-square" />
                Stop Recording
              </button>
            )}

            <div className="time">
              {formatTime(duration)}
            </div>
          </section>

          <audio
            ref={originalAudioRef}
            src={audioUrl ?? undefined}
            preload="auto"
          />

          <div className="hint">
            Click anywhere on the waveform to jump
            to that position.
          </div>
        </main>
      )}
    </div>
  );
}

export default App;