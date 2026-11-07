// Sound via Tone.js: a sampled grand piano (Salamander, CC-BY 3.0) plus three synth voices.
// Playback is scheduled on Tone.Transport with a Tone.Part, and note highlighting is synced with Tone.Draw.

const SAMPLE_BASE = 'samples/salamander/';
const SAMPLE_URLS = (() => {
  const urls = { A0: 'A0.mp3', C8: 'C8.mp3' };
  for (let o = 1; o <= 7; o++) {
    urls['C' + o] = `C${o}.mp3`;
    urls['D#' + o] = `Ds${o}.mp3`;
    urls['F#' + o] = `Fs${o}.mp3`;
    urls['A' + o] = `A${o}.mp3`;
  }
  return urls;
})();

let out = null;           // shared effects chain input
const instruments = {};   // lazily built per sound name
let current = 'piano';
let part = null;
let pianoState = 'loading';
const pianoListeners = new Set();

function chain() {
  if (out) return out;
  const Tone = window.Tone;
  const limiter = new Tone.Limiter(-1).toDestination();
  const reverb = new Tone.Reverb({ decay: 1.8, wet: 0.16 }).connect(limiter);
  out = new Tone.Gain(0.9).connect(reverb);
  return out;
}

function build(name) {
  const Tone = window.Tone;
  const dest = chain();
  switch (name) {
    case 'piano': {
      const s = new Tone.Sampler({
        urls: SAMPLE_URLS,
        baseUrl: SAMPLE_BASE,
        release: 1.2,
        onload: () => setPiano('ready'),
        onerror: () => setPiano('error'),
      }).connect(dest);
      return s;
    }
    case 'organ':
      return new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'custom', partials: [1, 0.55, 0.3, 0.16, 0.08] },
        envelope: { attack: 0.02, decay: 0.1, sustain: 0.9, release: 0.08 },
        volume: -12,
      }).connect(dest);
    case 'chip':
      return new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'square' },
        envelope: { attack: 0.003, decay: 0.05, sustain: 0.55, release: 0.03 },
        volume: -18,
      }).connect(dest);
    case 'pluck':
    default:
      return new Tone.PolySynth(Tone.MonoSynth, {
        oscillator: { type: 'sawtooth' },
        filter: { type: 'lowpass', Q: 1 },
        filterEnvelope: { attack: 0.001, decay: 0.25, sustain: 0.1, release: 0.2, baseFrequency: 250, octaves: 3.5 },
        envelope: { attack: 0.002, decay: 0.45, sustain: 0, release: 0.2 },
        volume: -14,
      }).connect(dest);
  }
}

function setPiano(s) { pianoState = s; pianoListeners.forEach((fn) => fn(s)); }

/** Start loading the piano samples right away (no audio gesture needed to fetch). */
export function preloadPiano(onState) {
  if (onState) { pianoListeners.add(onState); onState(pianoState); }
  if (!instruments.piano) instruments.piano = build('piano');
}

function inst() {
  if (current === 'piano' && pianoState !== 'ready') {
    // Fall back to the pluck synth until samples arrive.
    return instruments.pluck || (instruments.pluck = build('pluck'));
  }
  return instruments[current] || (instruments[current] = build(current));
}

export function setSound(name) { current = name; }

/** Must be called from a user gesture before the first sound. */
export async function unlock() {
  if (window.Tone.getContext().state !== 'running') await window.Tone.start();
}

const noteName = (m) => window.Tone.Frequency(m, 'midi').toNote();

export function preview(midis, vel = 0.7) {
  const i = inst();
  i.triggerAttackRelease(midis.map(noteName), 0.45, undefined, vel);
}
export function noteOn(m, vel = 0.8) { inst().triggerAttack(noteName(m), undefined, vel); }
export function noteOff(m) { inst().triggerRelease(noteName(m)); }

/**
 * Play timed events: [{ i, t, dur, midis }], total seconds.
 * onStep(i) fires in sync with the sound (i = -1 when done); onEnd fires when playback finishes.
 */
export function play(events, total, { loop = false, onStep, onEnd } = {}) {
  const Tone = window.Tone;
  stop();
  const ins = inst();
  const T = Tone.getTransport();
  part = new Tone.Part((time, ev) => {
    if (ev.midis.length) {
      const vel = 0.75 / Math.sqrt(ev.midis.length) + 0.1;
      ins.triggerAttackRelease(ev.midis.map(noteName), ev.dur * 0.96, time, vel);
    }
    Tone.getDraw().schedule(() => onStep?.(ev.i), time);
  }, events.map((e) => [e.t, e]));
  part.start(0);
  if (loop) {
    part.loop = true;
    part.loopEnd = total;
  } else {
    T.scheduleOnce((time) => Tone.getDraw().schedule(() => { stop(); onStep?.(-1); onEnd?.(); }, time), total + 0.05);
  }
  T.start('+0.05');
}

export function stop() {
  const Tone = window.Tone;
  const T = Tone.getTransport();
  T.stop();
  T.cancel();
  T.position = 0;
  if (part) { part.dispose(); part = null; }
  Object.values(instruments).forEach((i) => i.releaseAll?.());
}
