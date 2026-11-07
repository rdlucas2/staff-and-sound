// Sound via Tone.js. Every part gets its own instrument and Tone.Channel (volume, mute, solo),
// all feeding a master volume -> reverb -> limiter chain. The sampled grand piano
// (Salamander, CC BY 3.0) is loaded once and shared by every piano part.

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

let masterVol = null;
let buffers = null;
let pianoState = 'loading';
const channels = new Map();  // partId -> { channel, inst, kind }
let tonePart = null;

function master() {
  if (masterVol) return masterVol;
  const Tone = window.Tone;
  const limiter = new Tone.Limiter(-1).toDestination();
  const reverb = new Tone.Reverb({ decay: 1.8, wet: 0.16 }).connect(limiter);
  masterVol = new Tone.Volume(-2).connect(reverb);
  return masterVol;
}

/** Start fetching the piano samples. onState('loading' | 'ready' | 'error'). */
export function loadPiano(onState) {
  const Tone = window.Tone;
  onState?.(pianoState);
  buffers = new Tone.ToneAudioBuffers({
    urls: SAMPLE_URLS,
    baseUrl: SAMPLE_BASE,
    onload: () => { pianoState = 'ready'; onState?.('ready'); },
    onerror: () => { pianoState = 'error'; onState?.('error'); },
  });
}

function build(kind) {
  const Tone = window.Tone;
  switch (kind) {
    case 'piano': {
      const urls = {};
      for (const note of Object.keys(SAMPLE_URLS)) urls[note] = buffers.get(note);
      return new Tone.Sampler({ urls, release: 1.2 });
    }
    case 'organ':
      return new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'custom', partials: [1, 0.55, 0.3, 0.16, 0.08] },
        envelope: { attack: 0.02, decay: 0.1, sustain: 0.9, release: 0.08 },
        volume: -12,
      });
    case 'chip':
      return new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'square' },
        envelope: { attack: 0.003, decay: 0.05, sustain: 0.55, release: 0.03 },
        volume: -18,
      });
    case 'strings':
      return new Tone.PolySynth(Tone.Synth, {
        oscillator: { type: 'fatsawtooth', count: 3, spread: 24 },
        envelope: { attack: 0.18, decay: 0.2, sustain: 0.8, release: 0.5 },
        volume: -20,
      });
    case 'pluck':
    default:
      return new Tone.PolySynth(Tone.MonoSynth, {
        oscillator: { type: 'sawtooth' },
        filter: { type: 'lowpass', Q: 1 },
        filterEnvelope: { attack: 0.001, decay: 0.25, sustain: 0.1, release: 0.2, baseFrequency: 250, octaves: 3.5 },
        envelope: { attack: 0.002, decay: 0.45, sustain: 0, release: 0.2 },
        volume: -14,
      });
  }
}

/** Create or update the channel and instrument for a part. Returns the instrument. */
function ensure(part) {
  const Tone = window.Tone;
  let c = channels.get(part.id);
  if (!c) {
    c = { channel: new Tone.Channel().connect(master()), inst: null, kind: null };
    channels.set(part.id, c);
  }
  c.channel.volume.value = part.volume;
  c.channel.mute = !!part.mute;
  c.channel.solo = !!part.solo;
  // Piano parts use the pluck synth until the samples arrive.
  const kind = part.sound === 'piano' && pianoState !== 'ready' ? 'pluck' : part.sound;
  if (c.kind !== kind) {
    c.inst?.dispose();
    c.inst = build(kind).connect(c.channel);
    c.kind = kind;
  }
  return c.inst;
}

/** Bring channels in line with the current parts (adds, updates, removes). */
export function syncParts(parts) {
  const ids = new Set(parts.map((p) => p.id));
  for (const [id, c] of channels) {
    if (!ids.has(id)) { c.inst?.dispose(); c.channel.dispose(); channels.delete(id); }
  }
  parts.forEach(ensure);
}

/** Master volume, 0–100. */
export function setMasterVolume(pct) {
  const v = master();
  v.mute = pct <= 0;
  if (pct > 0) v.volume.value = 20 * Math.log10(pct / 100);
}

/** Must be called from a user gesture before the first sound. */
export async function unlock() {
  if (window.Tone.getContext().state !== 'running') await window.Tone.start();
}

const noteName = (m) => window.Tone.Frequency(m, 'midi').toNote();

export function preview(part, midis, vel = 0.7) { ensure(part).triggerAttackRelease(midis.map(noteName), 0.45, undefined, vel); }
export function noteOn(part, m, vel = 0.8) { ensure(part).triggerAttack(noteName(m), undefined, vel); }
export function noteOff(part, m) { ensure(part).triggerRelease(noteName(m)); }

/**
 * Play every part together.
 * tracks: [{ part, events: [{ i, t, dur, midis }], total }]
 * onStep(partIndex, noteIndex) fires in sync with the sound (noteIndex -1 = that part finished).
 */
export function play(tracks, { loop = false, onStep, onEnd } = {}) {
  const Tone = window.Tone;
  stop();
  const total = Math.max(0.01, ...tracks.map((t) => t.total));
  const all = [];
  tracks.forEach((tr, pi) => {
    const inst = ensure(tr.part);
    for (const ev of tr.events) all.push([ev.t, { pi, inst, ...ev }]);
    all.push([tr.total, { pi, inst, i: -1, midis: [] }]);
  });
  tonePart = new Tone.Part((time, ev) => {
    if (ev.midis.length) {
      const vel = 0.75 / Math.sqrt(ev.midis.length) + 0.1;
      ev.inst.triggerAttackRelease(ev.midis.map(noteName), ev.dur * 0.96, time, vel);
    }
    Tone.getDraw().schedule(() => onStep?.(ev.pi, ev.i), time);
  }, all);
  tonePart.start(0);
  const T = Tone.getTransport();
  if (loop) {
    tonePart.loop = true;
    tonePart.loopEnd = total;
  } else {
    T.scheduleOnce((time) => Tone.getDraw().schedule(() => { stop(); onEnd?.(); }, time), total + 0.05);
  }
  T.start('+0.05');
}

export function stop() {
  const Tone = window.Tone;
  const T = Tone.getTransport();
  T.stop();
  T.cancel();
  T.position = 0;
  if (tonePart) { tonePart.dispose(); tonePart = null; }
  for (const c of channels.values()) c.inst?.releaseAll?.();
}
