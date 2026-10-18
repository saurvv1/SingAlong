"""Prepare offline LRC timing for the single-song demo; no runtime AI service."""

from pathlib import Path
import json
import os
import re


ROOT = Path(__file__).resolve().parent
DEMO = ROOT.parent / "singalong" / "public" / "demo"
CACHE = ROOT / "models" / "lyrics"
AUDIT = ROOT / "generated" / "demo-lyrics"
CACHE.mkdir(parents=True, exist_ok=True)
AUDIT.mkdir(parents=True, exist_ok=True)
os.environ.setdefault("HF_HOME", str(CACHE / "huggingface"))
os.environ.setdefault("TORCH_HOME", str(ROOT / "models"))


def main():
    import stable_whisper
    import torch

    torch.set_num_threads(4)
    manifest = DEMO / "song.json"
    song = json.loads(manifest.read_text(encoding="utf-8"))
    lines = [line.strip() for line in song["plainLyrics"].splitlines() if line.strip()]
    lines = [line for line in lines if not re.fullmatch(r"\[[^\]]+\]", line)]
    if not lines:
        raise RuntimeError("No lyric text to align.")
    if any(line.casefold() == "you might also like" for line in lines):
        raise RuntimeError("Remove unrelated song recommendations from the lyric transcript first.")

    print(f"Aligning {len(lines)} lyric lines to the prepared vocals.", flush=True)
    model = stable_whisper.load_faster_whisper(
        "small.en", device="cpu", compute_type="int8", cpu_threads=4,
        download_root=str(CACHE / "whisper"),
    )
    result = model.align(
        str(DEMO / song["vocals"]), "\n".join(lines), language="en",
        original_split=True, regroup=False, verbose=False,
        failure_threshold=0.2, fast_mode=False,
    )
    if result is None:
        raise RuntimeError("Lyric alignment did not produce a result.")
    output = result.to_dict()
    (AUDIT / "alignment.json").write_text(json.dumps(output, ensure_ascii=False, indent=2), encoding="utf-8")
    segments = output["segments"]
    if len(segments) != len(lines):
        raise RuntimeError(f"Expected {len(lines)} lyric lines, got {len(segments)}.")

    lrc = []
    previous = -1.0
    for index, segment in enumerate(segments):
        start, end = float(segment["start"]), float(segment["end"])
        if start < 0 or start <= previous or end <= start:
            raise RuntimeError(f"Review timing at line {index + 1}: {start:.2f}–{end:.2f}.")
        previous = start
        centiseconds = round(start * 100)
        minutes, remainder = divmod(centiseconds, 6000)
        seconds, fraction = divmod(remainder, 100)
        lrc.append(f"[{minutes:02d}:{seconds:02d}.{fraction:02d}]{lines[index]}")

    song["syncedLyrics"] = "\n".join(lrc)
    song["lyricsTiming"] = "Aligned locally to the full music video vocals using stable-ts small.en."
    manifest.write_text(json.dumps(song, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Saved {len(lrc)} synchronized lines, {segments[0]['start']:.2f}s to {segments[-1]['end']:.2f}s.", flush=True)


if __name__ == "__main__":
    main()
