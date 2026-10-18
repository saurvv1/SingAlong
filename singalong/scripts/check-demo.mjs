import { readFileSync, statSync } from "node:fs";
import { dirname, resolve, relative, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";

const directory = resolve(dirname(fileURLToPath(import.meta.url)), "../public/demo");
try {
  const song = JSON.parse(readFileSync(resolve(directory, "song.json"), "utf8"));
  for (const field of ["title", "artist", "credit", "audio", "vocals", "instrumental"]) {
    if (typeof song[field] !== "string" || !song[field].trim()) throw new Error(`Missing ${field}.`);
  }
  for (const field of ["audio", "vocals", "instrumental"]) {
    const path = resolve(directory, song[field]);
    const child = relative(directory, path);
    if (child.startsWith("..") || isAbsolute(child)) throw new Error(`${field} must be inside public/demo.`);
    if (!statSync(path).isFile() || statSync(path).size === 0) throw new Error(`Empty ${field} file.`);
  }
  if (typeof song.syncedLyrics !== "string" || !song.syncedLyrics.trim()) throw new Error("The single-song demo requires synchronized LRC lyrics.");
  if (song.plainLyrics !== undefined && typeof song.plainLyrics !== "string") throw new Error("Plain lyrics must be text.");
  if (song.syncedLyrics && !/\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\]/.test(song.syncedLyrics)) throw new Error("Lyrics must use timestamped LRC format.");
  let previousLyricTime = -1;
  for (const line of song.syncedLyrics.split(/\r?\n/).filter((line) => line.trim())) {
    const match = line.match(/^\[(\d{1,3}):([0-5]\d)(?:[.:](\d{1,3}))?\](.+)$/);
    if (!match) throw new Error("Each lyric line must have a timestamp and text.");
    const time = Number(match[1]) * 60 + Number(match[2]) + Number(`0.${match[3] || "0"}`);
    if (time <= previousLyricTime) throw new Error("Lyric timestamps must increase in playback order.");
    previousLyricTime = time;
  }
  if (!/^[\w-]{11}$/.test(song.youtubeId)) throw new Error("Add the YouTube video ID.");
  if (!Number.isFinite(song.startSeconds) || song.startSeconds < 0) throw new Error("Add the excerpt start time in seconds.");
  console.log("Demo metadata, video ID, and audio files are present.");
} catch (error) {
  console.error(`Demo is not ready to publish: ${error.message}`);
  process.exitCode = 1;
}
