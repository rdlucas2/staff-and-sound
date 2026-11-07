import { normalizePatch } from './synth.js';

// Sound via Tone.js. Every part (and every backing-band instrument) gets its own instrument and
// Tone.Channel (volume, mute, solo), all feeding a master volume -> reverb -> limiter chain.
// The sampled grand piano (Salamander, CC BY 3.0) is loaded once and shared.

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
const channels = new Map(); // id -> { channel, inst, kind }
let tonePart = null;
let introPart = null;

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

// ---------- custom instruments ----------

/** Nylon-string guitar: a pool of Karplus-Strong plucked strings, strummed slightly. */
class Guitar {
  constructor() {
    const Tone = window.Tone;
    this.out = new Tone.Gain(1.3);
    const tone = new Tone.Filter({ type: 'lowpass', frequency: 3800, Q: 0.3 }).connect(this.out);
    this.voices = Array.from({ length: 10 }, () => {
      const g = new Tone.Gain(0.7).connect(tone);
      const s = new Tone.PluckSynth({ attackNoise: 1.2, dampening: 3400, resonance: 0.96, release: 0.6 }).connect(g);
      return { g, s };
    });
    this.next = 0;
  }
  connect(dest) { this.out.connect(dest); return this; }
  triggerAttackRelease(notes, dur, time, vel = 0.8) {
    const Tone = window.Tone;
    const t0 = time ?? Tone.now();
    [].concat(notes).forEach((n, k) => {
      const v = this.voices[this.next++ % this.voices.length];
      const t = t0 + k * 0.012;
      v.g.gain.setValueAtTime(0.25 + vel * 0.75, t);
      v.s.triggerAttackRelease(n, Math.max(0.05, dur), t);
    });
    return this;
  }
  triggerAttack(notes, time, vel) { return this.triggerAttackRelease(notes, 1.5, time, vel); }
  triggerRelease() { return this; }
  releaseAll() { return this; }
  dispose() { this.voices.forEach((v) => { v.s.dispose(); v.g.dispose(); }); this.out.dispose(); }
}

/**
 * User-editable synth (see synth.js for the patch model): two oscillator layers through a
 * filter with its own envelope, then vibrato, tremolo, chorus, delay and reverb.
 * setPatch() updates everything in place, so changes are heard while notes are playing.
 */
class SynthInstrument {
  constructor(patch) {
    const Tone = window.Tone;
    this.out = new Tone.Gain(1);
    this.reverb = new Tone.Reverb({ decay: 2.8, preDelay: 0.02, wet: 0 }).connect(this.out);
    this.delay = new Tone.FeedbackDelay({ delayTime: 0.28, feedback: 0.32, wet: 0 }).connect(this.reverb);
    this.chorus = new Tone.Chorus({ frequency: 1.3, delayTime: 3.5, depth: 0.7, spread: 160, wet: 0 }).connect(this.delay).start();
    this.trem = new Tone.Tremolo({ frequency: 4, depth: 0, spread: 0 }).connect(this.chorus).start();
    this.vib = new Tone.Vibrato({ frequency: 5, depth: 0 }).connect(this.trem);
    this.level = new Tone.Volume(-10).connect(this.vib);
    this.layers = [0, 1].map(() => ({ gain: new Tone.Gain(1).connect(this.level), synth: null, mono: null }));
    this.held = [];   // mono mode: keys held, newest last
    this.key = '';
    this.lastT = 0;   // mono synths need strictly increasing start times
    this.setPatch(patch);
  }
  connect(dest) { this.out.connect(dest); return this; }

  layerOptions(idx) {
    const p = this.patch;
    const o = idx === 0 ? p.osc : p.osc2;
    let oscillator;
    if (o.type === 'pulse') oscillator = { type: 'pulse', width: p.osc.width };
    else if (idx === 0 && p.osc.voices > 1) oscillator = { type: 'fat' + o.type, count: p.osc.voices, spread: p.osc.spread };
    else oscillator = { type: o.type };
    return {
      oscillator,
      detune: idx === 1 ? p.osc2.detune : 0,
      envelope: { ...p.amp },
      filter: { type: p.filter.type, Q: p.filter.q, rolloff: -24 },
      filterEnvelope: {
        baseFrequency: p.filter.cutoff, octaves: p.filter.env,
        attack: p.filter.attack, decay: p.filter.decay, sustain: p.filter.sustain, release: p.filter.release,
      },
      portamento: p.mono ? p.glide : 0,
    };
  }

  setPatch(raw) {
    const Tone = window.Tone;
    const p = normalizePatch(raw);
    const key = JSON.stringify(p);
    if (key === this.key) return;
    const old = this.patch;
    this.patch = p;
    this.key = key;
    this.shift = [12 * p.osc.octave + p.osc.semi, 12 * (p.osc.octave + p.osc2.octave) + p.osc.semi + p.osc2.semi];
    this.layers.forEach((L, idx) => {
      const opts = this.layerOptions(idx);
      const typeChanged = old && ((old.osc.type === 'pulse') !== (p.osc.type === 'pulse') || (idx === 0 && (old.osc.voices > 1) !== (p.osc.voices > 1)));
      if (!L.synth || L.mono !== p.mono || typeChanged) {
        L.synth?.dispose();
        L.synth = p.mono ? new Tone.MonoSynth(opts) : new Tone.PolySynth(Tone.MonoSynth, opts);
        L.synth.connect(L.gain);
        L.mono = p.mono;
        this.held = [];
      } else {
        L.synth.set(opts);
      }
    });
    const ramp = (param, v) => param.rampTo(v, 0.05);
    ramp(this.layers[1].gain.gain, p.osc2.on ? p.osc2.level : 0);
    ramp(this.level.volume, p.level);
    ramp(this.vib.depth, p.lfo.vibDepth * 0.5);
    ramp(this.vib.frequency, p.lfo.vibRate);
    ramp(this.trem.depth, p.lfo.tremDepth);
    ramp(this.trem.frequency, p.lfo.tremRate);
    ramp(this.chorus.wet, p.fx.chorus);
    ramp(this.delay.wet, p.fx.delay * 0.6);
    ramp(this.reverb.wet, p.fx.reverb * 0.7);
  }

  freq(note, layer) { return window.Tone.Frequency(note).transpose(this.shift[layer]).toFrequency(); }
  monoTime(time) {
    let t = time ?? window.Tone.now();
    if (t <= this.lastT) t = this.lastT + 0.002;
    this.lastT = t;
    return t;
  }
  active() { return this.patch.osc2.on ? [0, 1] : [0]; }

  triggerAttackRelease(notes, dur, time, vel = 0.8) {
    const list = [].concat(notes);
    for (const i of this.active()) {
      const L = this.layers[i];
      if (L.mono) L.synth.triggerAttackRelease(this.freq(list[list.length - 1], i), dur, i === 0 ? this.monoTime(time) : this.lastT, vel);
      else L.synth.triggerAttackRelease(list.map((n) => this.freq(n, i)), dur, time, vel);
    }
    return this;
  }
  triggerAttack(notes, time, vel = 0.8) {
    const list = [].concat(notes);
    if (this.patch.mono) {
      for (const n of list) { this.held = this.held.filter((h) => h !== n); this.held.push(n); }
      const top = this.held[this.held.length - 1];
      const t = this.monoTime(time);
      for (const i of this.active()) this.layers[i].synth.triggerAttack(this.freq(top, i), t, vel);
      return this;
    }
    for (const i of this.active()) this.layers[i].synth.triggerAttack(list.map((n) => this.freq(n, i)), time, vel);
    return this;
  }
  triggerRelease(notes, time) {
    const list = [].concat(notes);
    if (this.patch.mono) {
      const wasTop = this.held[this.held.length - 1];
      this.held = this.held.filter((h) => !list.includes(h));
      const top = this.held[this.held.length - 1];
      const t = this.monoTime(time);
      if (!top) for (const i of [0, 1]) this.layers[i].synth.triggerRelease(t);
      else if (top !== wasTop) for (const i of this.active()) this.layers[i].synth.triggerAttack(this.freq(top, i), t, 0.7);
      return this;
    }
    for (const i of [0, 1]) this.layers[i].synth.triggerRelease(list.map((n) => this.freq(n, i)), time);
    return this;
  }
  releaseAll() {
    this.held = [];
    for (const L of this.layers) { if (L.mono) L.synth.triggerRelease(); else L.synth.releaseAll(); }
    return this;
  }
  dispose() {
    this.layers.forEach((L) => { L.synth?.dispose(); L.gain.dispose(); });
    [this.level, this.vib, this.trem, this.chorus, this.delay, this.reverb, this.out].forEach((n) => n.dispose());
  }
}

// ---------- sampler ----------
// One shared sample (see sampler.js) played by every 'sampler' sound.
let sample = null; // { buffer: ToneAudioBuffer, settings }

/** Install the current sample ({ pcm, sampleRate, settings }) or clear it (null). */
export function setSample(data) {
  const Tone = window.Tone;
  if (!data) { sample = null; return; }
  const ctx = Tone.getContext().rawContext;
  const ab = ctx.createBuffer(1, data.pcm.length, data.sampleRate);
  const ch = ab.getChannelData(0);
  ch.set(data.pcm);
  if (data.settings.reverse) ch.reverse();
  sample = { buffer: new Tone.ToneAudioBuffer(ab), settings: { ...data.settings } };
}
/** Update settings that don't need a new buffer (root, trim, envelope, loop, level). */
export function setSampleSettings(settings) {
  if (sample) sample.settings = { ...settings };
}
export const hasSample = () => !!sample;

/** Plays the shared sample pitched across the keyboard; reads the sample at each note, so edits are heard right away. */
class SampleInstrument {
  constructor() {
    this.out = new window.Tone.Gain(1);
    this.voices = new Map(); // note -> [voice]
  }
  connect(dest) { this.out.connect(dest); return this; }
  start(note, time, vel = 0.8) {
    const Tone = window.Tone;
    if (!sample) return null;
    const st = sample.settings, dur = sample.buffer.duration;
    const m = Tone.Frequency(note).toMidi();
    const rate = Math.pow(2, (m - st.root) / 12);
    // Trim points are chosen on the forward waveform; flip them when the sample is reversed.
    let a = st.start * dur, b = st.end * dur;
    if (st.reverse) [a, b] = [dur - b, dur - a];
    if (b - a < 0.005) return null;
    const t = time ?? Tone.now();
    const src = new Tone.ToneBufferSource({ url: sample.buffer, playbackRate: rate, loop: st.loop, loopStart: a, loopEnd: b, fadeIn: 0.002, fadeOut: 0.005 });
    const g = new Tone.Gain(0).connect(this.out);
    src.connect(g);
    const peak = vel * Math.pow(10, st.level / 20);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + Math.max(0.002, st.attack));
    src.start(t, a);
    const v = { src, g, release: st.release, ended: false };
    if (!st.loop) src.stop(t + (b - a) / rate);
    src.onended = () => {
      v.ended = true;
      setTimeout(() => { g.dispose(); src.dispose(); }, 50);
      const list = this.voices.get(note);
      if (list) this.voices.set(note, list.filter((x) => x !== v));
    };
    if (!this.voices.has(note)) this.voices.set(note, []);
    this.voices.get(note).push(v);
    return v;
  }
  stopVoice(v, time) {
    if (!v || v.ended) return;
    const Tone = window.Tone;
    const t = Math.max(time ?? Tone.now(), Tone.now());
    v.g.gain.cancelScheduledValues(t);
    v.g.gain.setValueAtTime(v.g.gain.getValueAtTime(t), t);
    v.g.gain.linearRampToValueAtTime(0, t + v.release);
    try { v.src.stop(t + v.release + 0.02); } catch {}
  }
  triggerAttack(notes, time, vel) { [].concat(notes).forEach((n) => this.start(n, time, vel)); return this; }
  triggerRelease(notes, time) {
    for (const n of [].concat(notes)) {
      const list = this.voices.get(n) || [];
      list.forEach((v) => this.stopVoice(v, time));
      this.voices.delete(n);
    }
    return this;
  }
  triggerAttackRelease(notes, dur, time, vel) {
    const Tone = window.Tone;
    const t = time ?? Tone.now();
    for (const n of [].concat(notes)) {
      const v = this.start(n, t, vel);
      if (v) this.stopVoice(v, t + Math.max(0.03, dur));
    }
    return this;
  }
  releaseAll() { for (const n of [...this.voices.keys()]) this.triggerRelease(n); return this; }
  dispose() { this.releaseAll(); setTimeout(() => this.out.dispose(), 1000); }
}

/** Synthesized drum kit, played with General MIDI-style names. */
class DrumKit {
  constructor() {
    const Tone = window.Tone;
    this.out = new Tone.Gain(1);
    const o = this.out;
    this.kick = new Tone.MembraneSynth({ pitchDecay: 0.045, octaves: 6, envelope: { attack: 0.001, decay: 0.38, sustain: 0, release: 0.1 }, volume: 2 }).connect(o);
    const snareHp = new Tone.Filter({ type: 'highpass', frequency: 1400 }).connect(o);
    this.snare = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.17, sustain: 0, release: 0.03 }, volume: -8 }).connect(snareHp);
    this.snareBody = new Tone.MembraneSynth({ pitchDecay: 0.02, octaves: 2, envelope: { attack: 0.001, decay: 0.11, sustain: 0, release: 0.02 }, volume: -10 }).connect(o);
    this.rim = new Tone.MembraneSynth({ pitchDecay: 0.006, octaves: 1.5, envelope: { attack: 0.001, decay: 0.055, sustain: 0, release: 0.02 }, volume: -2 }).connect(o);
    const hatHp = new Tone.Filter({ type: 'highpass', frequency: 7500 }).connect(o);
    this.hat = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.001, decay: 0.05, sustain: 0, release: 0.02 }, volume: -9 }).connect(hatHp);
    this.ride = new Tone.MetalSynth({ envelope: { attack: 0.001, decay: 1.1, release: 0.3 }, harmonicity: 5.1, modulationIndex: 18, resonance: 5200, octaves: 1.1, volume: -17 }).connect(o);
    const crashHp = new Tone.Filter({ type: 'highpass', frequency: 3500 }).connect(o);
    this.crash = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.002, decay: 1.5, sustain: 0, release: 0.2 }, volume: -16 }).connect(crashHp);
    const shakerBp = new Tone.Filter({ type: 'bandpass', frequency: 6200, Q: 0.9 }).connect(o);
    this.shaker = new Tone.NoiseSynth({ noise: { type: 'white' }, envelope: { attack: 0.008, decay: 0.07, sustain: 0, release: 0.02 }, volume: -12 }).connect(shakerBp);
    this.parts = [this.kick, this.snare, this.snareBody, this.rim, this.hat, this.ride, this.crash, this.shaker, snareHp, hatHp, crashHp, shakerBp];
  }
  connect(dest) { this.out.connect(dest); return this; }
  hit(drum, time, vel = 0.8) {
    switch (drum) {
      case 'kick': this.kick.triggerAttackRelease('A1', 0.1, time, vel); break;
      case 'snare': this.snare.triggerAttackRelease(0.1, time, vel); this.snareBody.triggerAttackRelease('E3', 0.05, time, vel * 0.8); break;
      case 'rim': this.rim.triggerAttackRelease('F#5', 0.03, time, vel); break;
      case 'hhc': this.hat.envelope.decay = 0.05; this.hat.triggerAttackRelease(0.03, time, vel); break;
      case 'hhp': this.hat.envelope.decay = 0.035; this.hat.triggerAttackRelease(0.02, time, vel * 0.8); break;
      case 'hho': this.hat.envelope.decay = 0.32; this.hat.triggerAttackRelease(0.2, time, vel); break;
      case 'ride': this.ride.triggerAttackRelease(320, 0.05, time, vel); break;
      case 'crash': this.crash.triggerAttackRelease(0.5, time, vel); break;
      case 'shaker': this.shaker.triggerAttackRelease(0.04, time, vel); break;
      case 'click': this.rim.triggerAttackRelease('E6', 0.02, time, vel); break;     // metronome
      case 'clickHi': this.rim.triggerAttackRelease('B6', 0.02, time, vel); break;   // metronome downbeat
    }
  }
  // Instrument-like no-ops so a kit can sit in a channel like anything else.
  triggerAttackRelease() { return this; }
  triggerAttack() { return this; }
  triggerRelease() { return this; }
  releaseAll() { return this; }
  dispose() { this.parts.forEach((p) => p.dispose()); this.out.dispose(); }
}

function build(kind, part) {
  const Tone = window.Tone;
  switch (kind) {
    case 'synth':
      return new SynthInstrument(part?.patch);
    case 'sampler':
      return new SampleInstrument();
    case 'piano': {
      const urls = {};
      for (const note of Object.keys(SAMPLE_URLS)) urls[note] = buffers.get(note);
      return new Tone.Sampler({ urls, release: 1.2 });
    }
    case 'epiano':
      return new Tone.PolySynth(Tone.FMSynth, {
        harmonicity: 3, modulationIndex: 9,
        oscillator: { type: 'sine' }, modulation: { type: 'sine' },
        envelope: { attack: 0.002, decay: 1.4, sustain: 0.3, release: 0.9 },
        modulationEnvelope: { attack: 0.002, decay: 0.35, sustain: 0.08, release: 0.5 },
        volume: -5,
      });
    case 'guitar':
      return new Guitar();
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
    case 'upright':
      return new Tone.PolySynth(Tone.MonoSynth, {
        oscillator: { type: 'triangle' },
        filter: { type: 'lowpass', Q: 1, rolloff: -24 },
        filterEnvelope: { attack: 0.002, decay: 0.25, sustain: 0.25, release: 0.2, baseFrequency: 180, octaves: 2.4 },
        envelope: { attack: 0.005, decay: 0.9, sustain: 0.2, release: 0.12 },
        volume: -8,
      });
    case 'ebass':
      return new Tone.PolySynth(Tone.MonoSynth, {
        oscillator: { type: 'square' },
        filter: { type: 'lowpass', Q: 2.5, rolloff: -24 },
        filterEnvelope: { attack: 0.002, decay: 0.16, sustain: 0.3, release: 0.2, baseFrequency: 110, octaves: 2.6 },
        envelope: { attack: 0.003, decay: 0.3, sustain: 0.7, release: 0.08 },
        volume: -16,
      });
    case 'drums':
      return new DrumKit();
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

/** Create or update the channel and instrument for a part ({ id, sound, volume, mute, solo }). */
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
    c.inst = build(kind, part).connect(c.channel);
    c.kind = kind;
  } else if (kind === 'synth') {
    c.inst.setPatch(part.patch);
  }
  return c.inst;
}

/** Bring channels in line with the current parts and band instruments (adds, updates, removes). */
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
/** Release every note on a part's instrument (sustain off, panic). */
export function releaseAll(part) { ensure(part).releaseAll?.(); }
/** Hit one drum on a drum-kit part right now. */
export function hit(part, drum, vel = 0.8) { ensure(part).hit?.(drum, undefined, vel); }

/**
 * Play everything together.
 * tracks: [{ part: { id, sound, volume, mute, solo }, events: [{ t, dur, midis, vel?, i?, drum? }], hl? }]
 *   hl: index passed to onStep for highlighting (omit for band tracks)
 * marks: [{ t, key }] -> onMark(key) in sync with the sound (chord symbols)
 * intro: { part, events } played once before everything else (a count-in), lasting introLength
 *   seconds; with loop on, only the main part loops.
 * Returns the audio-clock time of the start (the intro's start, if there is one).
 */
export function play(tracks, { total, marks = [], loop = false, onStep, onMark, onEnd, intro = null, introLength = 0 } = {}) {
  const Tone = window.Tone;
  stop();
  const all = [];
  tracks.forEach((tr) => {
    const inst = ensure(tr.part);
    for (const ev of tr.events) all.push([ev.t, { inst, hl: tr.hl, ...ev }]);
    if (tr.hl !== undefined) all.push([tr.total ?? total, { inst, hl: tr.hl, i: -1, midis: [] }]);
  });
  for (const m of marks) all.push([m.t, { mark: m.key }]);
  tonePart = new Tone.Part((time, ev) => {
    if (ev.mark !== undefined) { Tone.getDraw().schedule(() => onMark?.(ev.mark), time); return; }
    if (ev.drum) ev.inst.hit(ev.drum, time, ev.vel ?? 0.8);
    else if (ev.midis?.length) {
      const vel = ev.vel ?? 0.75 / Math.sqrt(ev.midis.length) + 0.1;
      ev.inst.triggerAttackRelease(ev.midis.map(noteName), Math.max(0.03, ev.dur * 0.96), time, vel);
    }
    if (ev.hl !== undefined) Tone.getDraw().schedule(() => onStep?.(ev.hl, ev.i), time);
  }, all);
  const T = Tone.getTransport();
  const end = Math.max(0.05, total);
  if (intro?.events?.length) {
    const inst = ensure(intro.part);
    introPart = new Tone.Part((time, ev) => {
      if (ev.drum) inst.hit(ev.drum, time, ev.vel ?? 0.8);
      if (ev.mark !== undefined) Tone.getDraw().schedule(() => onMark?.(ev.mark), time);
    }, intro.events.map((e) => [e.t, e]));
    introPart.start(0);
  }
  tonePart.start(introLength);
  if (loop) {
    tonePart.loop = true;
    tonePart.loopEnd = end;
  } else {
    T.scheduleOnce((time) => Tone.getDraw().schedule(() => { stop(); onEnd?.(); }, time), introLength + end + 0.05);
  }
  const at = Tone.now() + 0.08;
  T.start(at);
  return at; // audio-clock time of t = 0
}

/** The audio clock right now, minus output latency: when a sound triggered now is actually heard. */
export function heardNow() {
  const Tone = window.Tone;
  const raw = Tone.getContext().rawContext;
  return Tone.immediate() - (raw.outputLatency || raw.baseLatency || 0);
}

export function stop() {
  const Tone = window.Tone;
  const T = Tone.getTransport();
  T.stop();
  T.cancel();
  T.position = 0;
  if (tonePart) { tonePart.dispose(); tonePart = null; }
  if (introPart) { introPart.dispose(); introPart = null; }
  for (const c of channels.values()) c.inst?.releaseAll?.();
}
