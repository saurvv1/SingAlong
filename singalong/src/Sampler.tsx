import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

type StoredSound = { id: string; name: string; file: Blob };
type Sound = StoredSound & { src: string; duration: number; peaks: number[] };
export type SamplerTake = { id: string; name: string; src: string; offset: number; duration: number; peaks: number[] };
type Assignments = { comma: string; period: string; slash: string };

const DATABASE = "singalong-sampler";
const STORE = "sounds";
const EMPTY_ASSIGNMENTS: Assignments = { comma: "", period: "", slash: "" };

function openSoundDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DATABASE, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withSounds<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>) {
  const database = await openSoundDatabase();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = action(database.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

async function analyzeSound(file: Blob) {
  try {
    const context = new AudioContext();
    try {
      const decoded = await context.decodeAudioData(await file.arrayBuffer());
      const samples = decoded.getChannelData(0);
      const count = 320;
      const bucketSize = Math.max(1, Math.floor(samples.length / count));
      const peaks = Array.from({ length: count }, (_, bucket) => {
        let peak = 0;
        for (let i = bucket * bucketSize; i < Math.min(samples.length, (bucket + 1) * bucketSize); i += 1) {
          peak = Math.max(peak, Math.abs(samples[i]));
        }
        return peak;
      });
      return { duration: decoded.duration, peaks };
    } finally {
      await context.close();
    }
  } catch {
    return { duration: 0, peaks: [] as number[] };
  }
}

export default function Sampler({
  enabled,
  currentTime,
  recording,
  playing,
  takes,
  setTakes,
}: {
  enabled: boolean;
  currentTime: number;
  recording: boolean;
  playing: boolean;
  takes: SamplerTake[];
  setTakes: Dispatch<SetStateAction<SamplerTake[]>>;
}) {
  const [sounds, setSounds] = useState<Sound[]>([]);
  const [assignments, setAssignments] = useState<Assignments>(EMPTY_ASSIGNMENTS);
  const [message, setMessage] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const voices = useRef(new Set<HTMLAudioElement>());
  const takeAudioRefs = useRef(new Map<string, HTMLAudioElement>());
  const soundsRef = useRef(sounds);
  const assignmentsRef = useRef(assignments);
  soundsRef.current = sounds;
  assignmentsRef.current = assignments;

  useEffect(() => {
    let active = true;
    try {
      const saved = localStorage.getItem("singalong-sampler-assignments");
      if (saved) setAssignments({ ...EMPTY_ASSIGNMENTS, ...JSON.parse(saved) });
    } catch {
      setMessage("Could not load saved sampler assignments.");
    }
    withSounds<StoredSound[]>("readonly", (store) => store.getAll())
      .then(async (stored) => {
        const loaded = await Promise.all(stored.map(async (sound) => ({
          ...sound,
          src: URL.createObjectURL(sound.file),
          ...await analyzeSound(sound.file),
        })));
        if (active) setSounds(loaded);
        else loaded.forEach((sound) => URL.revokeObjectURL(sound.src));
      })
      .catch(() => active && setMessage("Could not open the saved sound library in this browser."));
    return () => {
      active = false;
      soundsRef.current.forEach((sound) => URL.revokeObjectURL(sound.src));
      voices.current.forEach((voice) => voice.pause());
      takeAudioRefs.current.forEach((track) => track.pause());
    };
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("singalong-sampler-assignments", JSON.stringify(assignments));
    } catch {
      setMessage("Could not save sampler assignments.");
    }
  }, [assignments]);

  const assign = (slot: keyof Assignments, soundId: string) => {
    setAssignments((current) => ({ ...current, [slot]: soundId }));
    setMessage("");
  };

  const playSound = (soundId: string, capture = false) => {
    const sound = soundsRef.current.find((item) => item.id === soundId);
    if (!sound) return;
    const voice = new Audio(sound.src);
    voice.volume = 0.9;
    voices.current.add(voice);
    voice.onended = () => voices.current.delete(voice);
    void voice.play().catch(() => {
      voices.current.delete(voice);
      setMessage("The browser could not play this file. Try an MP3, WAV, or OGG sound.");
    });
    if (capture && recording && sound.duration > 0) {
      setTakes((current) => [...current, {
        id: crypto.randomUUID(),
        name: sound.name,
        src: sound.src,
        offset: currentTime,
        duration: sound.duration,
        peaks: sound.peaks,
      }]);
    }
  };

  useEffect(() => {
    if (!enabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.ctrlKey || event.metaKey || event.altKey || event.repeat) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      const slot = event.key === "," ? "comma" : event.key === "." ? "period" : event.key === "/" ? "slash" : null;
      if (!slot) return;
      const soundId = assignmentsRef.current[slot];
      if (soundId) {
        event.preventDefault();
        playSound(soundId, true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled, recording, currentTime]);

  useEffect(() => {
    if (recording || !playing) {
      takeAudioRefs.current.forEach((track) => track.pause());
      return;
    }
    const syncTakes = () => {
      for (const take of takes) {
        const track = takeAudioRefs.current.get(take.id);
        if (!track) continue;
        const time = currentTime;
        if (time >= take.offset && time < take.offset + take.duration) {
          const takeTime = time - take.offset;
          if (Math.abs(track.currentTime - takeTime) > 0.12) track.currentTime = takeTime;
          if (track.paused) void track.play().catch(() => {});
        } else if (!track.paused) track.pause();
      }
    };
    syncTakes();
    const timer = window.setInterval(syncTakes, 80);
    return () => window.clearInterval(timer);
  }, [takes, currentTime, recording, playing]);

  const addFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const valid = Array.from(files).filter((file) => file.type.startsWith("audio/"));
    if (!valid.length) {
      setMessage("Choose audio files such as MP3, WAV, or OGG.");
      return;
    }
    try {
      const added: Sound[] = [];
      for (const file of valid) {
        const sound: StoredSound = { id: crypto.randomUUID(), name: file.name, file };
        await withSounds("readwrite", (store) => store.put(sound));
        added.push({ ...sound, src: URL.createObjectURL(file), ...await analyzeSound(file) });
      }
      setSounds((current) => [...current, ...added]);
      setMessage(`${added.length} sound${added.length === 1 ? "" : "s"} added to your library.`);
    } catch {
      setMessage("Could not save those sounds. Check available browser storage and try again.");
    }
    if (fileInput.current) fileInput.current.value = "";
  };

  const removeSound = async (sound: Sound) => {
    try {
      await withSounds("readwrite", (store) => store.delete(sound.id));
      URL.revokeObjectURL(sound.src);
      setSounds((current) => current.filter((item) => item.id !== sound.id));
      setTakes((current) => current.filter((take) => take.src !== sound.src));
      setAssignments((current) => ({
        comma: current.comma === sound.id ? "" : current.comma,
        period: current.period === sound.id ? "" : current.period,
        slash: current.slash === sound.id ? "" : current.slash,
      }));
    } catch {
      setMessage("Could not remove that sound.");
    }
  };

  const soundName = (id: string) => sounds.find((sound) => sound.id === id)?.name ?? "Drop a sound here";

  return (
    <section className="sampler" aria-label="One-shot sound sampler">
      <div className="sampler-heading">
        <div><h2>One-shot sampler</h2><p>Add sounds, then click an assignment or drag it onto a key. Sounds play over the song.</p></div>
        <button className="sampler-add" type="button" onClick={() => fileInput.current?.click()}>Add sounds</button>
        <input ref={fileInput} className="sampler-file-input" type="file" accept="audio/*" multiple onChange={(event) => void addFiles(event.target.files)} />
      </div>
      <div className="sampler-pads">
        {(["comma", "period", "slash"] as const).map((slot) => {
          const key = slot === "comma" ? "," : slot === "period" ? "." : "/";
          return <button
            className="sampler-pad"
            type="button"
            key={slot}
            onClick={() => assignments[slot] && playSound(assignments[slot], true)}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => { event.preventDefault(); const id = event.dataTransfer.getData("text/sampler-sound"); if (sounds.some((sound) => sound.id === id)) assign(slot, id); }}
            aria-label={`Play ${key} sound: ${soundName(assignments[slot])}`}
            title={`Press ${key} to play`}
          ><kbd>{key}</kbd><span>{soundName(assignments[slot])}</span></button>;
        })}
      </div>
      {sounds.length > 0 ? <ul className="sampler-library">{sounds.map((sound) => <li key={sound.id} draggable onDragStart={(event) => event.dataTransfer.setData("text/sampler-sound", sound.id)}>
        <span className="sampler-sound-info"><span className="sampler-sound-name" title={sound.name}>{sound.name}</span><SoundWaveform peaks={sound.peaks} name={sound.name} /></span>
        <button type="button" onClick={() => playSound(sound.id)}>Preview</button>
        <button className={assignments.comma === sound.id ? "sampler-key-assigned" : ""} type="button" onClick={() => assign("comma", sound.id)} aria-label={`Assign ${sound.name} to comma key`} aria-pressed={assignments.comma === sound.id}>,</button>
        <button className={assignments.period === sound.id ? "sampler-key-assigned" : ""} type="button" onClick={() => assign("period", sound.id)} aria-label={`Assign ${sound.name} to period key`} aria-pressed={assignments.period === sound.id}>.</button>
        <button className={assignments.slash === sound.id ? "sampler-key-assigned" : ""} type="button" onClick={() => assign("slash", sound.id)} aria-label={`Assign ${sound.name} to slash key`} aria-pressed={assignments.slash === sound.id}>/</button>
        <button type="button" onClick={() => void removeSound(sound)} aria-label={`Remove ${sound.name}`}>×</button>
      </li>)}</ul> : <p className="sampler-empty">Add audio files from your computer to build your sound library.</p>}
      {takes.map((take) => <audio key={take.id} ref={(element) => {
        if (element) takeAudioRefs.current.set(take.id, element);
        else takeAudioRefs.current.delete(take.id);
      }} src={take.src} preload="auto" />)}
      {message && <p className="sampler-message" role="status">{message}</p>}
    </section>
  );
}

function SoundWaveform({ peaks, name }: { peaks: number[]; name: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    const width = canvas.width;
    const height = canvas.height;
    context.clearRect(0, 0, width, height);
    context.strokeStyle = "#78805e";
    context.lineWidth = 1;
    context.beginPath();
    peaks.forEach((peak, x) => {
      const amplitude = Math.max(1, peak * height * 0.46);
      const position = (x / Math.max(1, peaks.length)) * width;
      context.moveTo(position + 0.5, (height - amplitude) / 2);
      context.lineTo(position + 0.5, (height + amplitude) / 2);
    });
    context.stroke();
  }, [peaks]);

  return <canvas ref={canvasRef} className="sampler-waveform" role="img" aria-label={`Waveform for ${name}`} width={320} height={40} />;
}
