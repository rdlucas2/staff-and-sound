// UI wiring: state, editing, on-screen piano, computer keyboard, MIDI keyboard, playback.
import { parse, serialize, midiOf, pitchStr, midiToKey, toEvents } from './notation.js';
import { renderScore } from './score.js';
import * as audio from './audio.js';
import { buildMidiFile, saveMidi, connectMidiInput } from './midi.js';

const $ = (id) => document.getElementById(id);
const DRAFT_KEY = 'staff-and-sound:draft';

// Theme from Beethoven's Ninth (public domain), ending on a chord.
const SAMPLE = 'E4/q E4 F4 G4 | G4 F4 E4 D4 | C4 C4 D4 E4 | E4/q. D4/8 D4/h | E4/q E4 F4 G4 | G4 F4 E4 D4 | C4 C4 D4 E4 | D4/q. C4/8 (C4 E4 G4)/h';

const state = {
  notes: [],
  dur: 'q', dots: 0, chord: false,
  selected: -1,
  octave: 4,
  clef: 'treble', ts: '4/4',
  playing: false,
};
let noteEls = [];

// ---------- persistence (per-browser draft) ----------
function saveDraft() {
  try { localStorage.setItem(DRAFT_KEY, JSON.stringify({ text: serialize(state.notes, state.ts), clef: state.clef, ts: state.ts, bpm: +$('tempo').value })); } catch {}
}
function loadDraft() {
  try { return JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch { return null; }
}

// ---------- render ----------
function render() {
  const r = renderScore($('score'), state.notes, {
    clef: state.clef, ts: state.ts,
    onNoteClick: (i) => select(i === state.selected ? -1 : i),
  });
  noteEls = r.noteEls;
  paintSelection();
  const n = state.notes.length;
  const [, den] = state.ts.split('/').map(Number);
  const beats = (r.beats * den) / 4;
  $('metaLeft').textContent = n
    ? `${n} note${n === 1 ? '' : 's'} · ${r.bars} bar${r.bars === 1 ? '' : 's'} · ${Number.isInteger(beats) ? beats : beats.toFixed(2)} beats`
    : 'Empty staff: play a key to add a note';
}
function paintSelection() { noteEls.forEach((g, i) => g && g.classList.toggle('is-selected', i === state.selected)); }
function select(i) { state.selected = i; paintSelection(); }

function commit({ keepText = false } = {}) {
  if (!keepText) {
    $('text').value = serialize(state.notes, state.ts);
    $('text').classList.remove('bad');
    setMsg('');
  }
  render();
  saveDraft();
}

// ---------- editing ----------
let lastInsert = { idx: -1, at: 0 };

function insertNote(n) {
  const at = state.selected >= 0 ? state.selected + 1 : state.notes.length;
  state.notes.splice(at, 0, n);
  if (state.selected >= 0) state.selected = at;
  lastInsert = { idx: at, at: performance.now() };
  commit();
}

/** Add a pitch: as a new note, or onto an existing note when in chord mode / grouping a MIDI chord. */
function addPitch(k, { groupWindowMs = 0 } = {}) {
  const grouping = groupWindowMs && performance.now() - lastInsert.at < groupWindowMs && state.notes[lastInsert.idx];
  if ((state.chord && state.notes.length) || grouping) {
    const i = grouping ? lastInsert.idx : state.selected >= 0 ? state.selected : state.notes.length - 1;
    const n = state.notes[i];
    if (n.rest) { n.rest = false; n.keys = [k]; }
    else if (!n.keys.some((x) => midiOf(x) === midiOf(k))) n.keys.push(k);
    n.keys.sort((a, b) => midiOf(a) - midiOf(b));
    commit();
    return;
  }
  insertNote({ keys: [k], dur: state.dur, dots: state.dots, rest: false });
}
function addRest() { insertNote({ keys: [], dur: state.dur, dots: state.dots, rest: true }); }
function del() {
  if (!state.notes.length) return;
  const i = state.selected >= 0 ? state.selected : state.notes.length - 1;
  state.notes.splice(i, 1);
  if (state.selected >= 0) state.selected = state.notes.length ? Math.max(0, i - 1) : -1;
  commit();
}

function setDur(d) {
  state.dur = d;
  document.querySelectorAll('[data-dur]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.dur === d)));
  if (state.selected >= 0) { state.notes[state.selected].dur = d; commit(); }
}
function toggleDot() {
  state.dots = state.dots ? 0 : 1;
  $('dotBtn').setAttribute('aria-pressed', String(!!state.dots));
  if (state.selected >= 0) { state.notes[state.selected].dots = state.dots; commit(); }
}
function toggleChord() { state.chord = !state.chord; $('chordBtn').setAttribute('aria-pressed', String(state.chord)); }
function shiftOct(d) { state.octave = Math.max(1, Math.min(6, state.octave + d)); buildPiano(); }

function setMsg(t, bad) { $('msg').textContent = t; $('msg').classList.toggle('bad', !!bad); }
function setStatus(id, text, tone) { const el = $(id); el.textContent = text; el.dataset.tone = tone || ''; }

// ---------- sound helpers ----------
async function previewKey(k) {
  if (state.playing) return;
  await audio.unlock();
  audio.preview([midiOf(k)]);
}

// ---------- on-screen piano ----------
const WHITE = ['c', 'd', 'e', 'f', 'g', 'a', 'b'];
const BLACK_AFTER = [0, 1, 3, 4, 5]; // black key follows these white-key indexes
const BLACK_PC = [1, 3, 6, 8, 10];
const WHITE_HINT = ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k'];
const BLACK_HINT = ['w', 'e', 't', 'y', 'u'];
let keyMap = {};
const keyElsByMidi = new Map();

function buildPiano() {
  const p = $('piano');
  p.innerHTML = '';
  keyMap = {};
  keyElsByMidi.clear();
  const spell = $('spell').value, oct0 = state.octave, nOct = 2, whites = nOct * 7 + 1;
  const addWhite = (letter, oct, idx) => {
    const k = { letter, acc: '', oct };
    const el = document.createElement('div');
    el.className = 'wkey';
    const hint = WHITE_HINT[idx] || '';
    el.innerHTML = (hint ? `<span class="hint">${hint}</span>` : '') + (letter === 'c' ? `<span>C${oct}</span>` : '');
    el.title = pitchStr(k);
    if (hint) keyMap[hint] = { k, el };
    bindKey(el, k);
    p.appendChild(el);
  };
  for (let o = 0; o < nOct; o++) WHITE.forEach((l, i) => addWhite(l, oct0 + o, o * 7 + i));
  addWhite('c', oct0 + nOct, nOct * 7);
  for (let o = 0; o < nOct; o++) {
    BLACK_AFTER.forEach((after, j) => {
      const k = midiToKey(12 * (oct0 + o + 1) + BLACK_PC[j], spell);
      const el = document.createElement('div');
      el.className = 'bkey';
      const pos = o * 7 + after + 1;
      el.style.left = `calc(${(pos / whites) * 100}% - ${(0.62 / whites) * 50}%)`;
      el.style.width = `${(0.62 / whites) * 100}%`;
      if (o === 0) { el.textContent = BLACK_HINT[j]; keyMap[BLACK_HINT[j]] = { k, el }; }
      el.title = pitchStr(k);
      bindKey(el, k);
      p.appendChild(el);
    });
  }
}
function bindKey(el, k) {
  keyElsByMidi.set(midiOf(k), el);
  el.addEventListener('pointerdown', (e) => { e.preventDefault(); previewKey(k); addPitch({ ...k }); });
}
function flashKey(m, on) {
  const el = keyElsByMidi.get(m);
  if (el) el.classList.toggle('down', on);
}

// ---------- playback ----------
async function startPlayback() {
  if (!state.notes.length) return;
  await audio.unlock();
  const bpm = +$('tempo').value;
  const from = state.selected >= 0 ? state.selected : 0;
  const { events, total } = toEvents(state.notes, bpm, from);
  let lit = -1;
  state.playing = true;
  setPlayUI(true);
  audio.play(events, total, {
    loop: $('loop').checked,
    onStep: (i) => {
      if (noteEls[lit]) noteEls[lit].classList.remove('is-playing');
      if (noteEls[i]) noteEls[i].classList.add('is-playing');
      lit = i;
    },
    onEnd: () => { state.playing = false; setPlayUI(false); },
  });
  stopPlayback.clear = () => { if (noteEls[lit]) noteEls[lit].classList.remove('is-playing'); lit = -1; };
}
function stopPlayback() {
  audio.stop();
  stopPlayback.clear?.();
  state.playing = false;
  setPlayUI(false);
}
function togglePlay() { state.playing ? stopPlayback() : startPlayback(); }
function setPlayUI(on) {
  $('playLabel').textContent = on ? 'Stop' : 'Play';
  $('playBtn').setAttribute('aria-label', on ? 'Stop' : 'Play');
  $('playIcon').innerHTML = on ? '<rect x="3" y="3" width="10" height="10" rx="1"/>' : '<path d="M3 1.8v12.4L14 8z"/>';
}

// ---------- MIDI ----------
async function exportMidi() {
  if (!state.notes.length) { setStatus('exportStatus', 'Add some notes first.', 'warn'); return; }
  try {
    const bytes = buildMidiFile(state.notes, { bpm: +$('tempo').value, ts: state.ts });
    const kind = await saveMidi(bytes);
    setStatus('exportStatus', kind === 'zip' ? 'Saved as a .zip with the .mid inside.' : 'Saved staff-and-sound.mid.', 'ok');
  } catch (e) {
    setStatus('exportStatus', e.message, 'warn');
  }
}

async function connectMidi() {
  setStatus('midiStatus', 'Asking for MIDI access…');
  try {
    await connectMidiInput({
      onNoteOn: async (m, vel) => {
        flashKey(m, true);
        if (!state.playing) { await audio.unlock(); audio.noteOn(m, Math.max(0.2, vel)); }
        addPitch(midiToKey(m, $('spell').value), { groupWindowMs: 70 });
      },
      onNoteOff: (m) => { flashKey(m, false); audio.noteOff(m); },
      onDevices: (names) => setStatus('midiStatus',
        names.length ? `Listening: ${names.join(', ')}` : 'MIDI allowed. Plug in a keyboard.', names.length ? 'ok' : ''),
    });
    $('midiBtn').setAttribute('aria-pressed', 'true');
  } catch (e) {
    setStatus('midiStatus', e.message, 'warn');
  }
}

// ---------- events ----------
document.querySelectorAll('[data-dur]').forEach((b) => b.addEventListener('click', () => setDur(b.dataset.dur)));
$('dotBtn').addEventListener('click', toggleDot);
$('chordBtn').addEventListener('click', toggleChord);
$('restBtn').addEventListener('click', addRest);
$('delBtn').addEventListener('click', del);
$('clearBtn').addEventListener('click', () => { stopPlayback(); state.notes = []; state.selected = -1; commit(); });
$('clef').addEventListener('change', (e) => { state.clef = e.target.value; state.octave = state.clef === 'bass' ? 2 : 4; buildPiano(); render(); saveDraft(); });
$('timesig').addEventListener('change', (e) => { state.ts = e.target.value; commit(); });
$('octDown').addEventListener('click', () => shiftOct(-1));
$('octUp').addEventListener('click', () => shiftOct(1));
$('spell').addEventListener('change', buildPiano);
$('tempo').addEventListener('input', (e) => { $('tempoVal').textContent = e.target.value; });
$('tempo').addEventListener('change', saveDraft);
$('sound').addEventListener('change', (e) => audio.setSound(e.target.value));
$('score').addEventListener('click', () => select(-1));
$('playBtn').addEventListener('click', togglePlay);
$('exportBtn').addEventListener('click', exportMidi);
$('midiBtn').addEventListener('click', connectMidi);

$('text').addEventListener('input', (e) => {
  const r = parse(e.target.value);
  if (r.error) {
    setMsg(`Can't read “${r.error}”. Expected something like C#4/q, (C4 E4)/h or r/8.`, true);
    e.target.classList.add('bad');
    return;
  }
  e.target.classList.remove('bad');
  setMsg('');
  state.notes = r.notes;
  state.selected = -1;
  commit({ keepText: true });
});
$('text').addEventListener('blur', (e) => { if (!e.target.classList.contains('bad')) e.target.value = serialize(state.notes, state.ts); });

const DUR_KEYS = { '1': 'w', '2': 'h', '3': 'q', '4': '8', '5': '16' };
document.addEventListener('keydown', (e) => {
  if (e.target.matches('textarea, input, select') || e.metaKey || e.ctrlKey || e.altKey) return;
  const key = e.key.toLowerCase();
  if (keyMap[key]) {
    e.preventDefault();
    if (e.repeat) return;
    const { k, el } = keyMap[key];
    el.classList.add('down');
    setTimeout(() => el.classList.remove('down'), 140);
    previewKey(k);
    addPitch({ ...k });
    return;
  }
  if (DUR_KEYS[key]) { setDur(DUR_KEYS[key]); return; }
  switch (key) {
    case '.': toggleDot(); break;
    case 'c': toggleChord(); break;
    case 'r': addRest(); break;
    case 'z': shiftOct(-1); break;
    case 'x': shiftOct(1); break;
    case 'backspace': case 'delete': e.preventDefault(); del(); break;
    case 'escape': select(-1); break;
    case 'arrowleft': e.preventDefault(); select(state.selected < 0 ? state.notes.length - 1 : Math.max(0, state.selected - 1)); break;
    case 'arrowright': e.preventDefault(); if (state.selected >= 0) select(Math.min(state.notes.length - 1, state.selected + 1)); break;
    case ' ': e.preventDefault(); togglePlay(); break;
  }
});

// ---------- boot ----------
const draft = loadDraft();
const start = draft && parse(draft.text || '');
if (start && !start.error && start.notes.length) {
  state.notes = start.notes;
  state.clef = draft.clef || 'treble';
  state.ts = draft.ts || '4/4';
  if (draft.bpm) { $('tempo').value = draft.bpm; $('tempoVal').textContent = draft.bpm; }
} else {
  state.notes = parse(SAMPLE).notes;
}
$('clef').value = state.clef;
$('timesig').value = state.ts;
state.octave = state.clef === 'bass' ? 2 : 4;
setDur('q');
buildPiano();
commit();

audio.preloadPiano((s) => {
  const label = { loading: 'Loading piano samples…', ready: 'Piano ready', error: 'Piano samples failed to load; using a synth' }[s];
  setStatus('soundStatus', label, s === 'ready' ? 'ok' : s === 'error' ? 'warn' : '');
});
if (!navigator.requestMIDIAccess) setStatus('midiStatus', 'No Web MIDI in this browser', 'warn');

let resizeTimer;
new ResizeObserver(() => { clearTimeout(resizeTimer); resizeTimer = setTimeout(render, 80); }).observe($('score'));
document.fonts?.ready.then(render);
