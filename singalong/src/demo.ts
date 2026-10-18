export const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === "true";

export type DemoSong = {
  title: string;
  artist: string;
  credit: string;
  audio: string;
  vocals: string;
  instrumental: string;
  syncedLyrics: string;
  youtubeId: string;
  startSeconds: number;
};

export const demoAsset = (path: string) => `${import.meta.env.BASE_URL}demo/${path}`;

// Adapt browser audio to the transport already used by the recording and sampler.
export function createDemoPlayer(audio: HTMLAudioElement) {
  return {
    getPlayerState: () => audio.ended ? 0 : audio.paused ? 2 : 1,
    getCurrentTime: () => audio.currentTime,
    getDuration: () => Number.isFinite(audio.duration) ? audio.duration : 0,
    playVideo: () => audio.play(),
    pauseVideo: () => audio.pause(),
    seekTo: (time: number) => { audio.currentTime = time; },
    mute: () => { audio.muted = true; },
    unMute: () => { audio.muted = true; },
    destroy: () => audio.pause(),
  };
}
