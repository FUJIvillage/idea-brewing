"use client";

type WaveType = OscillatorType;

let audioCtx: AudioContext | null = null;
let muted = false;

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  try {
    if (!audioCtx) {
      const AC =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext })
          .webkitAudioContext;
      audioCtx = new AC();
    }
    if (audioCtx.state === "suspended") void audioCtx.resume();
    return audioCtx;
  } catch {
    return null;
  }
}

export function setSoundMuted(next: boolean) {
  muted = next;
}

export function isSoundMuted() {
  return muted;
}

export function unlockAudio() {
  getCtx();
}

export function blip(freq = 520, dur = 0.07, type: WaveType = "square") {
  if (muted) return;
  const ac = getCtx();
  if (!ac) return;
  try {
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0.045, ac.currentTime);
    g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
    o.connect(g);
    g.connect(ac.destination);
    o.start();
    o.stop(ac.currentTime + dur + 0.02);
  } catch {
    /* no audio */
  }
}

export function confirmSound() {
  blip(520, 0.06);
  setTimeout(() => blip(780, 0.09), 70);
}

export function cursorSound() {
  blip(560);
}

export function backSound() {
  blip(300, 0.1);
}

export function offSound() {
  blip(320);
}
