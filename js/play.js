// Freeplay page: a keyboard-only instrument with the synth editor, MIDI input, sustain and drum pads.
import * as audio from './audio.js';
import { connectMidiInput } from './midi.js';
import { defaultPatch, normalizePatch } from './synth.js';
import { mountSynthPanel } from './synth-panel.js';
import { createKeyboard, noteLabel } from './keyboard.js';

const $ = (id) => document.getElementById(id);
const STORE_KEY = 'staff-and-sound:freeplay';
const SOUNDS = {
  synth: 'Synth (editable)', piano: 'Grand piano', epiano: 'Electric piano', organ: 'Organ', strings: 'Strings',
  guitar: 'Nylon guitar', pluck: 'Pluck synth', chip: 'Chiptune', upright: 'Upright bass', ebass: 'Electric bass',
};
const PADS = [
  ['kick', 'Kick'], ['snare', 'Snare'], ['rim', 'Rim'], ['hhc', 'Closed hat'],
  ['hho', 'Open hat'], ['ride', 'Ride'], ['crash', 'Crash'], ['shaker', 'Shaker'],
];
// Computer keys, as semitones above the hinted C.
const KEYMAP = { a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11, k: 12, o: 13, l: 14, p: 15, ';': 16, "'": 17 };

const state = {
  sound: 'synth', patch: defaultPatch(), octave: 3, span: window.innerWidth < 640 ? 2 : 3,
  transpose: 0, velocity: 75, volume: 80, sustain: false,
};
try {
  const s = JSON.parse(localStorage.getItem(STORE_KEY) || 'null');
  if (s) {
    Object.assign(state, {
      sound: SOUNDS[s.sound] ? s.sound : state.sound,
      patch: normalizePatch(s.patch),
      octave: Math.min(6, Math.max(1, s.octave ?? state.octave)),
      span: [2, 3, 4].includes(s.span) ? s.span : state.span,
      transpose: Math.min(12, Math.max(-12, s.transpose ?? 0)),
      velocity: s.velocity ?? state.velocity,
      volume: s.volume ?? state.volume,
    });
  }
} catch {}
let saveTimer;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      const { sustain, ...rest } = state;
      localStorage.setItem(STORE_KEY, JSON.stringify(rest));
    } catch {}
  }, 300);
}

const part = () => ({ id: 'free', sound: state.sound, volume: 0, mute: false, solo: false, patch: state.patch });
const drums = { id: 'free-drums', sound: 'drums', volume: -3, mute: false, solo: false };
const sync = () => audio.syncParts([part(), drums]);

// ---------- notes ----------
const held = new Map();   // source key -> sounding midi (after transpose)
const sustained = new Set();

// Synchronous on purpose: awaiting the audio unlock here lets a fast glissando release a key
// before its note-on registers, leaving a stuck note. Notes triggered while audio is still
// starting simply sound once it's running.
function noteOn(src, m, vel) {
  audio.unlock();
  const sm = m + state.transpose;
  if (held.has(src)) noteOff(src, m);
  if (sustained.has(sm)) { audio.noteOff(part(), sm); sustained.delete(sm); }
  held.set(src, sm);
  audio.noteOn(part(), sm, vel);
  kb.setDown(m, true);
}
function noteOff(src, m) {
  const sm = held.get(src);
  kb.setDown(m, false);
  if (sm === undefined) return;
  held.delete(src);
  if ([...held.values()].includes(sm)) return; // still held by another source
  if (state.sustain) sustained.add(sm);
  else audio.noteOff(part(), sm);
}
function setSustain(on) {
  state.sustain = on;
  $('fpSustain').setAttribute('aria-pressed', String(on));
  if (!on) {
    const holding = new Set(held.values());
    for (const sm of sustained) if (!holding.has(sm)) audio.noteOff(part(), sm);
    sustained.clear();
  }
}
function panic() {
  kb.releaseAll();
  held.clear();
  sustained.clear();
  setSustain(false);
  audio.releaseAll(part());
  document.querySelectorAll('.kb .down').forEach((k) => k.classList.remove('down'));
}

// ---------- keyboard ----------
const kb = createKeyboard($('fpKeyboard'), {
  onNoteOn: (m, v) => noteOn('p:' + m, m, v),
  onNoteOff: (m) => noteOff('p:' + m, m),
});
const lowNote = () => 12 * (state.octave + 1);
const hintBase = () => lowNote() + (state.span >= 3 ? 12 : 0);
function layoutKeyboard() {
  panic();
  const low = lowNote(), high = low + 12 * state.span;
  const hints = {};
  for (const [k, off] of Object.entries(KEYMAP)) if (hintBase() + off <= high) hints[hintBase() + off] = k === ';' ? ';' : k;
  kb.setRange(low, high, hints);
  $('fpOct').textContent = noteLabel(low);
  $('fpTr').textContent = state.transpose > 0 ? `+${state.transpose}` : String(state.transpose);
  save();
}

// ---------- drum pads ----------
$('fpPads').innerHTML = PADS.map(([id, label], i) =>
  `<button class="fp-pad" type="button" data-drum="${id}"><span>${label}</span><span class="kbd">${i + 1}</span></button>`).join('');
function pad(id, el) {
  audio.unlock();
  audio.hit(drums, id, state.velocity / 100);
  el?.classList.add('hit');
  setTimeout(() => el?.classList.remove('hit'), 120);
}
$('fpPads').addEventListener('pointerdown', (e) => {
  const b = e.target.closest('[data-drum]');
  if (b) { e.preventDefault(); pad(b.dataset.drum, b); }
});

// ---------- controls ----------
$('fpSound').innerHTML = Object.entries(SOUNDS).map(([v, l]) => `<option value="${v}">${l}</option>`).join('');
$('fpSound').value = state.sound;
$('fpSpan').value = String(state.span);
$('fpVolume').value = state.volume; $('fpVolumeVal').textContent = state.volume;
$('fpVel').value = state.velocity; $('fpVelVal').textContent = state.velocity;

function showSynth() { $('fpSynthPanel').classList.toggle('dimmed', state.sound !== 'synth'); }
$('fpSound').addEventListener('change', (e) => { panic(); state.sound = e.target.value; sync(); showSynth(); save(); });
$('fpSpan').addEventListener('change', (e) => { state.span = +e.target.value; layoutKeyboard(); });
$('fpVolume').addEventListener('input', (e) => { state.volume = +e.target.value; $('fpVolumeVal').textContent = state.volume; audio.setMasterVolume(state.volume); save(); });
$('fpVel').addEventListener('input', (e) => { state.velocity = +e.target.value; $('fpVelVal').textContent = state.velocity; save(); });
const shiftOct = (d) => { state.octave = Math.min(6, Math.max(1, state.octave + d)); layoutKeyboard(); };
const shiftTr = (d) => { panic(); state.transpose = Math.min(12, Math.max(-12, state.transpose + d)); layoutKeyboard(); };
$('fpOctDown').addEventListener('click', () => shiftOct(-1));
$('fpOctUp').addEventListener('click', () => shiftOct(1));
$('fpTrDown').addEventListener('click', () => shiftTr(-1));
$('fpTrUp').addEventListener('click', () => shiftTr(1));
$('fpSustain').addEventListener('click', () => setSustain(!state.sustain));
$('fpPanic').addEventListener('click', panic);

const synthPanel = mountSynthPanel($('fpSynthPanel'), {
  idPrefix: 'fp',
  getPatch: () => state.patch,
  onChange: (patch, { structural }) => {
    if (state.sound !== 'synth') { state.sound = 'synth'; $('fpSound').value = 'synth'; showSynth(); }
    if (structural) panic();
    sync();
    save();
  },
});

// Computer keyboard.
const downKeys = new Map(); // key -> midi
document.addEventListener('keydown', (e) => {
  if (e.target.matches('input, select, textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
  const key = e.key.toLowerCase();
  if (key in KEYMAP) {
    e.preventDefault();
    if (e.repeat || downKeys.has(key)) return;
    const m = hintBase() + KEYMAP[key];
    downKeys.set(key, m);
    noteOn('c:' + key, m, state.velocity / 100);
    return;
  }
  if (e.key === ' ') { e.preventDefault(); if (!e.repeat) setSustain(true); return; }
  if (/^[1-8]$/.test(e.key)) { const [id] = PADS[+e.key - 1]; pad(id, document.querySelector(`[data-drum="${id}"]`)); return; }
  if (key === 'z') shiftOct(-1);
  if (key === 'x') shiftOct(1);
  if (e.key === 'Escape') panic();
});
document.addEventListener('keyup', (e) => {
  const key = e.key.toLowerCase();
  if (downKeys.has(key)) { noteOff('c:' + key, downKeys.get(key)); downKeys.delete(key); }
  if (e.key === ' ') setSustain(false);
});
window.addEventListener('blur', () => { for (const [key, m] of downKeys) noteOff('c:' + key, m); downKeys.clear(); });

// MIDI keyboard: notes, velocity and the sustain pedal (CC 64).
function setStatus(id, text, tone) { const el = $(id); el.textContent = text; el.dataset.tone = tone || ''; }
$('fpMidi').addEventListener('click', async () => {
  setStatus('fpMidiStatus', 'Asking for MIDI access…');
  try {
    await connectMidiInput({
      onNoteOn: (m, v) => noteOn('m:' + m, m, Math.max(0.15, v)),
      onNoteOff: (m) => noteOff('m:' + m, m),
      onControl: (cc, v) => { if (cc === 64) setSustain(v >= 0.5); },
      onDevices: (names) => setStatus('fpMidiStatus', names.length ? `Listening: ${names.join(', ')}` : 'MIDI allowed. Plug in a keyboard.', names.length ? 'ok' : ''),
    });
    $('fpMidi').setAttribute('aria-pressed', 'true');
  } catch (err) {
    setStatus('fpMidiStatus', err.message, 'warn');
  }
});
if (!navigator.requestMIDIAccess) setStatus('fpMidiStatus', 'No Web MIDI in this browser', 'warn');

// ---------- boot ----------
audio.loadPiano((s) => {
  if (state.sound === 'piano' || s === 'error') {
    setStatus('fpSoundStatus', { loading: 'Loading piano samples…', ready: 'Piano ready', error: 'Piano samples failed to load; using a synth' }[s], s === 'ready' ? 'ok' : s === 'error' ? 'warn' : '');
  }
  if (s !== 'loading') sync();
});
sync();
audio.setMasterVolume(state.volume);
showSynth();
layoutKeyboard();
