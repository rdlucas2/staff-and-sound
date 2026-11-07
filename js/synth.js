// Synth patches: the parameter model, presets, and helpers. No audio code here (see audio.js),
// so this module also runs in Node.
//
// A patch:
// {
//   name,
//   osc:  { type: 'sawtooth'|'square'|'triangle'|'sine'|'pulse', width, octave, semi, voices, spread }
//   osc2: { on, type, octave, semi, detune (cents), level (0–1) }
//   amp:  { attack, decay, sustain, release }          seconds / level
//   filter: { type: 'lowpass'|'highpass'|'bandpass', cutoff (Hz), q, env (octaves), attack, decay, sustain, release }
//   lfo:  { vibRate, vibDepth (0–1), tremRate, tremDepth (0–1) }
//   mono, glide (s)
//   fx:   { chorus, delay, reverb }                     wet 0–1
//   level (dB), gm (General MIDI program for export)
// }

export const WAVES = ['sawtooth', 'square', 'triangle', 'sine', 'pulse'];
export const FILTER_TYPES = ['lowpass', 'highpass', 'bandpass'];

const INIT = {
  name: 'Init',
  osc: { type: 'sawtooth', width: 0.5, octave: 0, semi: 0, voices: 1, spread: 20 },
  osc2: { on: false, type: 'square', octave: 0, semi: 0, detune: 7, level: 0.5 },
  amp: { attack: 0.01, decay: 0.2, sustain: 0.8, release: 0.3 },
  filter: { type: 'lowpass', cutoff: 6000, q: 1, env: 0, attack: 0.01, decay: 0.3, sustain: 0.5, release: 0.3 },
  lfo: { vibRate: 5, vibDepth: 0, tremRate: 4, tremDepth: 0 },
  mono: false, glide: 0,
  fx: { chorus: 0, delay: 0, reverb: 0.15 },
  level: -12, gm: 81,
};

const merge = (base, over) => {
  const out = structuredClone(base);
  for (const [k, v] of Object.entries(over || {})) {
    out[k] = v && typeof v === 'object' && !Array.isArray(v) ? { ...out[k], ...v } : v;
  }
  return out;
};

export const PRESETS = [
  INIT,
  merge(INIT, { name: 'Synth Brass', gm: 62,
    osc: { type: 'sawtooth', voices: 3, spread: 18 },
    amp: { attack: 0.06, decay: 0.3, sustain: 0.75, release: 0.25 },
    filter: { cutoff: 520, q: 2, env: 3, attack: 0.09, decay: 0.45, sustain: 0.45, release: 0.3 },
    fx: { chorus: 0.2, reverb: 0.25 }, level: -8.5 }),
  merge(INIT, { name: 'Synth Strings', gm: 50,
    osc: { type: 'sawtooth', voices: 5, spread: 38 },
    amp: { attack: 0.4, decay: 0.6, sustain: 0.85, release: 1.3 },
    filter: { cutoff: 2600, q: 0.7, env: 0.5, attack: 0.5, decay: 1, sustain: 0.6, release: 1 },
    lfo: { vibRate: 5, vibDepth: 0.05 },
    fx: { chorus: 0.55, reverb: 0.45 }, level: -4 }),
  merge(INIT, { name: 'Square Lead', gm: 80,
    osc: { type: 'square' },
    osc2: { on: true, type: 'square', octave: 1, detune: 6, level: 0.3 },
    amp: { attack: 0.005, decay: 0.15, sustain: 0.85, release: 0.15 },
    filter: { cutoff: 3200, q: 1.5, env: 1, attack: 0.005, decay: 0.2, sustain: 0.6 },
    lfo: { vibRate: 5.5, vibDepth: 0.12 },
    mono: true, glide: 0.04,
    fx: { delay: 0.22, reverb: 0.2 }, level: -13 }),
  merge(INIT, { name: 'Glass Bell', gm: 14,
    osc: { type: 'sine' },
    osc2: { on: true, type: 'triangle', octave: 2, semi: 7, detune: 3, level: 0.35 },
    amp: { attack: 0.002, decay: 1.6, sustain: 0, release: 1.8 },
    filter: { cutoff: 9000, q: 0.5 },
    fx: { chorus: 0.2, delay: 0.15, reverb: 0.5 }, level: -7 }),
  merge(INIT, { name: 'Synth Bass', gm: 38,
    osc: { type: 'square' },
    osc2: { on: true, type: 'sawtooth', octave: -1, detune: 4, level: 0.55 },
    amp: { attack: 0.003, decay: 0.3, sustain: 0.55, release: 0.1 },
    filter: { cutoff: 240, q: 6, env: 2.6, attack: 0.002, decay: 0.22, sustain: 0.15, release: 0.15 },
    mono: true, glide: 0.02,
    fx: { reverb: 0.05 }, level: -12 }),
  merge(INIT, { name: 'Warm Pad', gm: 89,
    osc: { type: 'triangle', voices: 3, spread: 24 },
    osc2: { on: true, type: 'sawtooth', octave: -1, detune: 5, level: 0.35 },
    amp: { attack: 0.9, decay: 1, sustain: 0.9, release: 2.2 },
    filter: { cutoff: 1300, q: 0.8, env: 0.8, attack: 1.2, decay: 1.5, sustain: 0.5, release: 2 },
    lfo: { tremRate: 0.4, tremDepth: 0.25 },
    fx: { chorus: 0.7, reverb: 0.65 }, level: -4 }),
  merge(INIT, { name: '8-bit Lead', gm: 80,
    osc: { type: 'pulse', width: 0.25 },
    amp: { attack: 0.001, decay: 0.06, sustain: 0.75, release: 0.04 },
    filter: { cutoff: 12000, q: 0.5 },
    lfo: { vibRate: 6, vibDepth: 0.08 },
    fx: { delay: 0.12, reverb: 0.05 }, level: -18 }),
  merge(INIT, { name: 'Wah Clav', gm: 7,
    osc: { type: 'pulse', width: 0.35 },
    amp: { attack: 0.002, decay: 0.35, sustain: 0.2, release: 0.12 },
    filter: { type: 'bandpass', cutoff: 700, q: 4, env: 3.2, attack: 0.002, decay: 0.18, sustain: 0.15, release: 0.1 },
    fx: { reverb: 0.1 }, level: 5 }),
];

export const defaultPatch = () => structuredClone(PRESETS.find((p) => p.name === 'Synth Brass') || INIT);

const num = (v, lo, hi, d) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, +v)) : d);

/** Fill in missing fields and clamp everything to safe ranges. */
export function normalizePatch(p) {
  const x = merge(INIT, p || {});
  x.osc.type = WAVES.includes(x.osc.type) ? x.osc.type : 'sawtooth';
  x.osc2.type = WAVES.includes(x.osc2.type) ? x.osc2.type : 'square';
  x.filter.type = FILTER_TYPES.includes(x.filter.type) ? x.filter.type : 'lowpass';
  x.osc.width = num(x.osc.width, 0.05, 0.95, 0.5);
  x.osc.octave = Math.round(num(x.osc.octave, -2, 2, 0));
  x.osc.semi = Math.round(num(x.osc.semi, -12, 12, 0));
  x.osc.voices = Math.round(num(x.osc.voices, 1, 7, 1));
  x.osc.spread = num(x.osc.spread, 0, 100, 20);
  x.osc2.on = !!x.osc2.on;
  x.osc2.octave = Math.round(num(x.osc2.octave, -2, 2, 0));
  x.osc2.semi = Math.round(num(x.osc2.semi, -12, 12, 0));
  x.osc2.detune = num(x.osc2.detune, -50, 50, 7);
  x.osc2.level = num(x.osc2.level, 0, 1, 0.5);
  for (const k of ['attack', 'decay', 'release']) x.amp[k] = num(x.amp[k], 0.001, 8, 0.1);
  x.amp.sustain = num(x.amp.sustain, 0, 1, 0.8);
  x.filter.cutoff = num(x.filter.cutoff, 40, 18000, 6000);
  x.filter.q = num(x.filter.q, 0.1, 20, 1);
  x.filter.env = num(x.filter.env, 0, 6, 0);
  for (const k of ['attack', 'decay', 'release']) x.filter[k] = num(x.filter[k], 0.001, 8, 0.2);
  x.filter.sustain = num(x.filter.sustain, 0, 1, 0.5);
  x.lfo.vibRate = num(x.lfo.vibRate, 0.1, 20, 5);
  x.lfo.vibDepth = num(x.lfo.vibDepth, 0, 1, 0);
  x.lfo.tremRate = num(x.lfo.tremRate, 0.1, 20, 4);
  x.lfo.tremDepth = num(x.lfo.tremDepth, 0, 1, 0);
  x.mono = !!x.mono;
  x.glide = num(x.glide, 0, 1, 0);
  for (const k of ['chorus', 'delay', 'reverb']) x.fx[k] = num(x.fx[k], 0, 1, 0);
  x.level = num(x.level, -40, 6, -10);
  x.gm = Math.round(num(x.gm, 0, 127, 81));
  x.name = String(x.name || 'Custom').slice(0, 30);
  return x;
}

/**
 * The controls shown in the editor, grouped like a keyboard's front panel.
 * Each control: { path, label, kind: 'range'|'select'|'toggle', min, max, step, scale: 'log'?, unit, options? }
 */
export const CONTROLS = [
  { group: 'Oscillator', items: [
    { path: 'osc.type', label: 'Wave', kind: 'select', options: WAVES },
    { path: 'osc.width', label: 'Pulse width', kind: 'range', min: 0.05, max: 0.95, step: 0.01, unit: '%', when: (p) => p.osc.type === 'pulse' },
    { path: 'osc.octave', label: 'Octave', kind: 'range', min: -2, max: 2, step: 1, unit: 'oct' },
    { path: 'osc.semi', label: 'Semitone', kind: 'range', min: -12, max: 12, step: 1, unit: 'st' },
    { path: 'osc.voices', label: 'Unison', kind: 'range', min: 1, max: 7, step: 1, unit: 'voices', when: (p) => p.osc.type !== 'pulse' },
    { path: 'osc.spread', label: 'Spread', kind: 'range', min: 0, max: 100, step: 1, unit: 'cents', when: (p) => p.osc.type !== 'pulse' && p.osc.voices > 1 },
  ] },
  { group: 'Oscillator 2', items: [
    { path: 'osc2.on', label: 'On', kind: 'toggle' },
    { path: 'osc2.type', label: 'Wave', kind: 'select', options: WAVES.filter((w) => w !== 'pulse') },
    { path: 'osc2.octave', label: 'Octave', kind: 'range', min: -2, max: 2, step: 1, unit: 'oct' },
    { path: 'osc2.semi', label: 'Semitone', kind: 'range', min: -12, max: 12, step: 1, unit: 'st' },
    { path: 'osc2.detune', label: 'Detune', kind: 'range', min: -50, max: 50, step: 1, unit: 'cents' },
    { path: 'osc2.level', label: 'Level', kind: 'range', min: 0, max: 1, step: 0.01, unit: '%' },
  ] },
  { group: 'Amp envelope', env: 'amp', items: [
    { path: 'amp.attack', label: 'Attack', kind: 'range', min: 0.001, max: 4, step: 0.001, scale: 'log', unit: 's' },
    { path: 'amp.decay', label: 'Decay', kind: 'range', min: 0.01, max: 4, step: 0.001, scale: 'log', unit: 's' },
    { path: 'amp.sustain', label: 'Sustain', kind: 'range', min: 0, max: 1, step: 0.01, unit: '%' },
    { path: 'amp.release', label: 'Release', kind: 'range', min: 0.01, max: 6, step: 0.001, scale: 'log', unit: 's' },
  ] },
  { group: 'Filter', items: [
    { path: 'filter.type', label: 'Type', kind: 'select', options: FILTER_TYPES },
    { path: 'filter.cutoff', label: 'Cutoff', kind: 'range', min: 40, max: 18000, step: 1, scale: 'log', unit: 'Hz' },
    { path: 'filter.q', label: 'Resonance', kind: 'range', min: 0.1, max: 20, step: 0.1, scale: 'log', unit: 'Q' },
    { path: 'filter.env', label: 'Env amount', kind: 'range', min: 0, max: 6, step: 0.1, unit: 'oct' },
  ] },
  { group: 'Filter envelope', env: 'filter', items: [
    { path: 'filter.attack', label: 'Attack', kind: 'range', min: 0.001, max: 4, step: 0.001, scale: 'log', unit: 's' },
    { path: 'filter.decay', label: 'Decay', kind: 'range', min: 0.01, max: 4, step: 0.001, scale: 'log', unit: 's' },
    { path: 'filter.sustain', label: 'Sustain', kind: 'range', min: 0, max: 1, step: 0.01, unit: '%' },
    { path: 'filter.release', label: 'Release', kind: 'range', min: 0.01, max: 6, step: 0.001, scale: 'log', unit: 's' },
  ] },
  { group: 'Modulation', items: [
    { path: 'lfo.vibRate', label: 'Vib. rate', kind: 'range', min: 0.1, max: 12, step: 0.1, unit: 'Hz' },
    { path: 'lfo.vibDepth', label: 'Vib. depth', kind: 'range', min: 0, max: 1, step: 0.01, unit: '%' },
    { path: 'lfo.tremRate', label: 'Trem. rate', kind: 'range', min: 0.1, max: 12, step: 0.1, unit: 'Hz' },
    { path: 'lfo.tremDepth', label: 'Trem. depth', kind: 'range', min: 0, max: 1, step: 0.01, unit: '%' },
    { path: 'mono', label: 'Mono', kind: 'toggle' },
    { path: 'glide', label: 'Glide', kind: 'range', min: 0, max: 0.5, step: 0.005, unit: 's', when: (p) => p.mono },
  ] },
  { group: 'Effects', items: [
    { path: 'fx.chorus', label: 'Chorus', kind: 'range', min: 0, max: 1, step: 0.01, unit: '%' },
    { path: 'fx.delay', label: 'Delay', kind: 'range', min: 0, max: 1, step: 0.01, unit: '%' },
    { path: 'fx.reverb', label: 'Reverb', kind: 'range', min: 0, max: 1, step: 0.01, unit: '%' },
    { path: 'level', label: 'Level', kind: 'range', min: -40, max: 6, step: 0.5, unit: 'dB' },
  ] },
];

export const getPath = (obj, path) => path.split('.').reduce((o, k) => o?.[k], obj);
export function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (const k of keys.slice(0, -1)) o = o[k];
  o[keys[keys.length - 1]] = value;
}

/** Human-readable value for a control. */
export function formatValue(c, v) {
  switch (c.unit) {
    case 's': return v < 1 ? `${Math.round(v * 1000)} ms` : `${v.toFixed(2)} s`;
    case 'Hz': return v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 1 : 2)} kHz` : `${v < 20 ? v.toFixed(1) : Math.round(v)} Hz`;
    case '%': return `${Math.round(v * 100)}%`;
    case 'dB': return `${v > 0 ? '+' : ''}${v} dB`;
    case 'Q': return v.toFixed(1);
    case 'cents': return `${v > 0 ? '+' : ''}${Math.round(v)}¢`;
    case 'oct': return `${v > 0 ? '+' : ''}${Number.isInteger(v) ? v : v.toFixed(1)}`;
    case 'st': return `${v > 0 ? '+' : ''}${v}`;
    case 'voices': return `${v}`;
    default: return String(v);
  }
}
