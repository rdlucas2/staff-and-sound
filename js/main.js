// UI wiring: parts, chords and band, editing, on-screen piano, computer keyboard, MIDI keyboard, playback.
import { parse, serialize, midiOf, pitchStr, midiToKey, toEvents, capQ } from './notation.js';
import { renderScore } from './score.js';
import * as audio from './audio.js';
import { buildMidiFile, saveMidi, connectMidiInput } from './midi.js';
import { importMidi, notesFromRaw } from './midi-import.js';
import { parseChart, chartFromText, chartToText, spellInChord } from './chords.js';
import { STYLES, generateBacking } from './band.js';
import { buildPlan, BAND_IDS, hasChords } from './plan.js';

const $ = (id) => document.getElementById(id);
const DRAFT_KEY = 'staff-and-sound:draft:v2';
const OLD_DRAFT_KEY = 'staff-and-sound:draft';
const MAX_PARTS = 8;
const PART_COLORS = ['#8a2f5e', '#1f7a72', '#b0661a', '#4a5bb8', '#5e7d24', '#a23b3b', '#6b4fa0', '#2f6f9a'];
const SOUND_LABELS = {
  piano: 'Grand piano', epiano: 'Electric piano', guitar: 'Nylon guitar', organ: 'Organ', strings: 'Strings',
  upright: 'Upright bass', ebass: 'Electric bass', pluck: 'Pluck synth', chip: 'Chiptune',
};
const COMP_SOUNDS = ['piano', 'epiano', 'guitar', 'organ', 'strings', 'pluck', 'chip'];
const BASS_SOUNDS = ['upright', 'ebass', 'pluck', 'piano'];
const BAND_COLORS = { comp: '#8c7a3e', bass: '#3f6b8c', drums: '#6f6a7a' };
const PROGRESSIONS = [
  { name: 'Jazz blues in F', style: 'swing', chart: 'F7 | Bb7 | F7 | Cm7 F7 | Bb7 | Bdim7 | F7 | D7alt | Gm7 | C7 | F7 D7 | Gm7 C7' },
  { name: 'ii–V–I, major then minor', style: 'swing', chart: 'Dm7 | G7 | Cmaj7 | % | Dm7b5 | G7b9 | Cm6 | %' },
  { name: 'Rhythm changes, A section', style: 'swing', chart: 'Bb6 G7 | Cm7 F7 | Dm7 G7 | Cm7 F7 | Fm7 Bb7 | Ebmaj7 Ab7 | Dm7 G7 | Cm7 F7' },
  { name: 'Bossa in D minor', style: 'bossa', chart: 'Dm9 | % | Em7b5 | A7b9 | Dm9 | % | Gm9 | C9 | Fmaj7 | Bbmaj7 | Em7b5 | A7b9 | Dm9 | % | Em7b5 A7b9 | Dm9' },
  { name: 'Jazz waltz in F', style: 'waltz', chart: 'Fmaj7 | Gm7 C7 | Am7 | D7b9 | Gm7 | C7 | Fmaj7 | Gm7 C7' },
  { name: 'Ballad in E♭', style: 'ballad', chart: 'Ebmaj7 | Cm7 | Fm7 | Bb7sus4 Bb7 | Gm7 | C7 | Fm7 | Bb7' },
  { name: 'Pop: I–V–vi–IV', style: 'pop', chart: 'C | G | Am | F | C | G | Am | F' },
  { name: 'Funk vamp in E', style: 'funk', chart: 'E7#9 | % | % | % | A9 | % | E7#9 | %' },
];
const SOUND_CYCLE = ['piano', 'strings', 'organ', 'pluck', 'chip'];
let EXAMPLES = []; // loaded from demos/examples.json

// Theme from Beethoven's Ninth (public domain), with chords for the band.
const SAMPLE_PARTS = [
  { name: 'Melody', clef: 'treble', sound: 'piano', volume: 0,
    text: 'E4/q E4 F4 G4 | G4 F4 E4 D4 | C4 C4 D4 E4 | E4/q. D4/8 D4/h | E4/q E4 F4 G4 | G4 F4 E4 D4 | C4 C4 D4 E4 | D4/q. C4/8 C4/h' },
];
const SAMPLE_CHART = ['C', 'G', 'C', 'G', 'C', 'G7', 'C Am', 'G7 C'];

const defaultBand = () => ({
  on: true, style: 'pop', seed: 1, chart: [],
  comp: { sound: STYLES.pop.comp, volume: -4, mute: false },
  bass: { sound: STYLES.pop.bass, volume: -2, mute: false },
  drums: { volume: -6, mute: false },
});

let nextId = 1;
const state = {
  parts: [],
  active: 0,
  dur: 'q', dots: 0, chord: false,
  selected: -1,          // note index in the active part
  octave: 4,
  ts: '4/4',
  playing: false,
  band: defaultBand(),
};
let noteEls = [];
let chordEls = {};
let slots = [];
const part = () => state.parts[state.active];

function makePart(fields = {}) {
  const used = new Set(state.parts.map((p) => p.color));
  const color = PART_COLORS.find((c) => !used.has(c)) || PART_COLORS[state.parts.length % PART_COLORS.length];
  return {
    id: nextId++, name: `Part ${state.parts.length + 1}`, clef: 'treble', sound: 'piano',
    volume: 0, mute: false, solo: false, notes: [], color, ...fields,
  };
}

const bandChannels = () => [
  { id: BAND_IDS.comp, solo: false, ...state.band.comp },
  { id: BAND_IDS.bass, solo: false, ...state.band.bass },
  { id: BAND_IDS.drums, solo: false, sound: 'drums', ...state.band.drums },
];
/** Keep audio channels in line with parts and band instruments. */
const syncAudio = () => audio.syncParts([...state.parts, ...bandChannels()]);

// ---------- persistence (per-browser draft) ----------
function saveDraft() {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify({
      ts: state.ts, bpm: +$('tempo').value, master: +$('master').value, active: state.active, band: state.band,
      parts: state.parts.map((p) => ({ name: p.name, clef: p.clef, sound: p.sound, volume: p.volume, mute: p.mute, solo: p.solo, text: serialize(p.notes, state.ts) })),
    }));
  } catch {}
}
function loadDraft() {
  try {
    const d = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
    if (d?.parts?.length) return d;
    const old = JSON.parse(localStorage.getItem(OLD_DRAFT_KEY) || 'null');
    if (old?.text) return { ts: old.ts, bpm: old.bpm, parts: [{ name: 'Part 1', clef: old.clef || 'treble', sound: 'piano', volume: 0, text: old.text }] };
  } catch {}
  return null;
}

// ---------- render ----------
function chartParsed() {
  const [num, den] = state.ts.split('/').map(Number);
  return parseChart(state.band.chart, num, 4 / den);
}

function render() {
  closeChordEditor();
  const empty = !state.parts.some((p) => p.notes.length) && !state.band.chart.length;
  const r = renderScore($('score'), state.parts, {
    ts: state.ts,
    active: state.active,
    chart: chartParsed(),
    minBars: Math.max(empty ? 4 : 1, extraBars),
    onChordClick: (bar) => openChordEditor(bar),
    onNoteClick: (pi, i) => {
      if (pi !== state.active) { setActive(pi, i); return; }
      select(i === state.selected ? -1 : i);
    },
    onStaffClick: (pi) => { if (pi !== state.active) setActive(pi); else select(-1); },
  });
  noteEls = r.noteEls;
  chordEls = r.chordEls;
  slots = r.slots;
  paintSelection();
  const total = state.parts.reduce((s, p) => s + p.notes.length, 0);
  const [, den] = state.ts.split('/').map(Number);
  const beats = (r.beats * den) / 4;
  const nParts = state.parts.length;
  $('metaLeft').textContent = total
    ? `${nParts} part${nParts === 1 ? '' : 's'} · ${total} notes · ${r.bars} bar${r.bars === 1 ? '' : 's'} · ${Number.isInteger(beats) ? beats : beats.toFixed(2)} beats`
    : 'Empty staff: play a key to add a note, or click above a bar to add chords';
}
function paintSelection() {
  noteEls.forEach((els, pi) => els.forEach((g, i) => g && g.classList.toggle('is-selected', pi === state.active && i === state.selected)));
}
function select(i) { state.selected = i; paintSelection(); }

function syncText() {
  $('text').value = serialize(part().notes, state.ts);
  $('text').classList.remove('bad');
  setMsg('');
  $('textPart').textContent = part().name;
  $('textPart').style.setProperty('--pc', part().color);
}

function commit({ keepText = false } = {}) {
  if (!keepText) syncText();
  render();
  saveDraft();
}

// ---------- parts ----------
function setActive(pi, selectIndex = -1) {
  state.active = pi;
  state.selected = selectIndex;
  state.octave = part().clef === 'bass' ? 2 : 4;
  buildPiano();
  renderParts();
  commit();
}

function addPart() {
  if (state.parts.length >= MAX_PARTS) return;
  const sound = SOUND_CYCLE[state.parts.length % SOUND_CYCLE.length];
  state.parts.push(makePart({ sound }));
  syncAudio();
  setActive(state.parts.length - 1);
}

function removePart(pi) {
  if (state.parts.length <= 1) return;
  if (state.playing) stopPlayback();
  state.parts.splice(pi, 1);
  syncAudio();
  setActive(Math.min(state.active >= pi ? Math.max(0, state.active - 1) : state.active, state.parts.length - 1));
}

function updatePart(pi, fields, { rerender = false } = {}) {
  Object.assign(state.parts[pi], fields);
  syncAudio();
  if (rerender) { renderParts(); commit({ keepText: pi !== state.active }); if (pi === state.active) buildPiano(); }
  else saveDraft();
}

const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function renderParts() {
  const list = $('parts');
  list.innerHTML = state.parts.map((p, pi) => `
    <article class="part${pi === state.active ? ' is-active' : ''}" data-pi="${pi}" style="--pc:${p.color}" aria-label="${esc(p.name)}">
      <div class="part-head">
        <span class="chip" aria-hidden="true"></span>
        <input class="part-name" id="pname-${p.id}" value="${esc(p.name)}" maxlength="24" aria-label="Part name">
        <button class="icon-btn" type="button" data-act="remove" title="Remove part" aria-label="Remove ${esc(p.name)}" ${state.parts.length <= 1 ? 'disabled' : ''}>×</button>
      </div>
      <div class="part-row">
        <select id="psound-${p.id}" data-act="sound" aria-label="Sound">
          ${Object.entries(SOUND_LABELS).map(([v, l]) => `<option value="${v}"${v === p.sound ? ' selected' : ''}>${l}</option>`).join('')}
        </select>
        <select id="pclef-${p.id}" data-act="clef" aria-label="Clef">
          <option value="treble"${p.clef === 'treble' ? ' selected' : ''}>Treble</option>
          <option value="bass"${p.clef === 'bass' ? ' selected' : ''}>Bass</option>
        </select>
      </div>
      <div class="part-row">
        <input type="range" id="pvol-${p.id}" data-act="volume" min="-30" max="6" step="1" value="${p.volume}" aria-label="Volume for ${esc(p.name)}">
        <span class="db">${p.volume > 0 ? '+' : ''}${p.volume} dB</span>
        <button class="ms${p.mute ? ' on' : ''}" type="button" data-act="mute" aria-pressed="${p.mute}" title="Mute">M</button>
        <button class="ms solo${p.solo ? ' on' : ''}" type="button" data-act="solo" aria-pressed="${p.solo}" title="Solo">S</button>
      </div>
    </article>`).join('') + (state.parts.length < MAX_PARTS
    ? `<button class="part add" id="addPart" type="button"><span class="plus" aria-hidden="true">+</span><span>Add part</span><span class="sub">Layer another instrument</span></button>`
    : '');
}

$('parts').addEventListener('click', (e) => {
  if (e.target.id === 'addPart' || e.target.closest('#addPart')) { addPart(); return; }
  const card = e.target.closest('.part[data-pi]');
  if (!card) return;
  const pi = +card.dataset.pi;
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (act === 'remove') { removePart(pi); return; }
  if (act === 'mute') { updatePart(pi, { mute: !state.parts[pi].mute }); renderParts(); return; }
  if (act === 'solo') { updatePart(pi, { solo: !state.parts[pi].solo }); renderParts(); return; }
  if (pi !== state.active && !e.target.matches('input, select')) setActive(pi);
});
$('parts').addEventListener('focusin', (e) => {
  const card = e.target.closest('.part[data-pi]');
  if (card && +card.dataset.pi !== state.active && e.target.matches('input.part-name')) {
    state.active = +card.dataset.pi; state.selected = -1;
    document.querySelectorAll('.part[data-pi]').forEach((c) => c.classList.toggle('is-active', +c.dataset.pi === state.active));
    buildPiano(); commit();
  }
});
$('parts').addEventListener('input', (e) => {
  const card = e.target.closest('.part[data-pi]');
  if (!card) return;
  const pi = +card.dataset.pi;
  if (e.target.matches('.part-name')) {
    state.parts[pi].name = e.target.value.trim() || `Part ${pi + 1}`;
    if (pi === state.active) $('textPart').textContent = state.parts[pi].name;
    render(); saveDraft();
  } else if (e.target.dataset.act === 'volume') {
    const v = +e.target.value;
    card.querySelector('.db').textContent = `${v > 0 ? '+' : ''}${v} dB`;
    updatePart(pi, { volume: v });
  }
});
$('parts').addEventListener('change', (e) => {
  const card = e.target.closest('.part[data-pi]');
  if (!card) return;
  const pi = +card.dataset.pi;
  if (e.target.dataset.act === 'sound') updatePart(pi, { sound: e.target.value });
  if (e.target.dataset.act === 'clef') {
    updatePart(pi, { clef: e.target.value }, { rerender: true });
    if (pi === state.active) { state.octave = e.target.value === 'bass' ? 2 : 4; buildPiano(); }
  }
});

// ---------- chords & band ----------
const band = () => state.band;

function chartMessage() {
  const { errors } = chartParsed();
  if (!errors.length) { $('chartMsg').textContent = ''; $('chartMsg').classList.remove('bad'); return; }
  const list = errors.slice(0, 3).map((e) => `“${e.token}” (bar ${e.bar + 1})`).join(', ');
  $('chartMsg').textContent = `Don't recognize ${list}${errors.length > 3 ? ' and more' : ''}. Try forms like Cmaj7, Dm7b5, G7#9, F/A or Bb6.`;
  $('chartMsg').classList.add('bad');
}

function syncChartText() {
  if (document.activeElement !== $('chart')) $('chart').value = chartToText(band().chart);
  chartMessage();
}

function setChart(bars) {
  while (bars.length && !bars[bars.length - 1].trim()) bars.pop();
  band().chart = bars;
  syncChartText();
  render();
  saveDraft();
}

function bandTrackCard(key, label, sounds) {
  const t = band()[key];
  const sel = sounds
    ? `<select id="bsound-${key}" data-bact="sound" aria-label="${label} sound">${sounds.map((v) => `<option value="${v}"${v === t.sound ? ' selected' : ''}>${SOUND_LABELS[v]}</option>`).join('')}</select>`
    : '<span class="band-sub">Drum kit</span>';
  return `<article class="part band-track" data-band="${key}" style="--pc:${BAND_COLORS[key]}" aria-label="${label}">
    <div class="part-head"><span class="chip" aria-hidden="true"></span><span class="band-name">${label}</span></div>
    <div class="part-row">${sel}</div>
    <div class="part-row">
      <input type="range" id="bvol-${key}" data-bact="volume" min="-30" max="6" step="1" value="${t.volume}" aria-label="${label} volume">
      <span class="db">${t.volume > 0 ? '+' : ''}${t.volume} dB</span>
      <button class="ms${t.mute ? ' on' : ''}" type="button" data-bact="mute" aria-pressed="${t.mute}" title="Mute">M</button>
    </div>
  </article>`;
}

function renderBand() {
  const b = band();
  $('bandStyle').value = b.style;
  $('bandOn').checked = b.on;
  $('styleDesc').textContent = STYLES[b.style].desc;
  $('bandTracks').innerHTML = bandTrackCard('comp', 'Comping', COMP_SOUNDS) + bandTrackCard('bass', 'Bass', BASS_SOUNDS) + bandTrackCard('drums', 'Drums', null);
  $('bandTracks').classList.toggle('off', !b.on);
  syncChartText();
}

function setStyle(key) {
  const st = STYLES[key];
  const b = band();
  b.style = key;
  b.comp.sound = st.comp;
  b.bass.sound = st.bass;
  $('tempo').value = st.tempo;
  $('tempoVal').textContent = st.tempo;
  const tsChanged = st.ts !== state.ts;
  if (tsChanged) setTimeSig(st.ts);
  renderBand();
  syncAudio();
  commit();
  setStatus('importStatus', `${st.name}: ${st.tempo} bpm${tsChanged ? `, time signature changed to ${st.ts}` : ''}.`, 'ok');
}

$('bandStyle').innerHTML = Object.entries(STYLES).map(([k, st]) => `<option value="${k}">${st.name}</option>`).join('');
$('progression').innerHTML = '<option value="">Load a progression…</option>' + PROGRESSIONS.map((p, i) => `<option value="${i}">${esc(p.name)} · ${STYLES[p.style].name}</option>`).join('');

$('bandStyle').addEventListener('change', (e) => { stopPlayback(); setUndo(); setStyle(e.target.value); });
$('bandOn').addEventListener('change', (e) => { band().on = e.target.checked; renderBand(); saveDraft(); });
$('bandVary').addEventListener('click', () => {
  band().seed = (band().seed % 9973) + 1;
  saveDraft();
  setStatus('importStatus', `Band variation ${band().seed}. Play to hear it.`, 'ok');
});
$('progression').addEventListener('change', (e) => {
  const p = PROGRESSIONS[+e.target.value];
  e.target.value = '';
  if (!p) return;
  stopPlayback();
  setUndo();
  band().chart = chartFromText(p.chart);
  band().on = true;
  setStyle(p.style);
  syncChartText();
  setStatus('importStatus', `Loaded “${p.name}” (${STYLES[p.style].name}, ${band().chart.length} bars).`, 'ok');
});
$('chart').addEventListener('input', (e) => {
  band().chart = chartFromText(e.target.value);
  chartMessage();
  render();
  saveDraft();
});
$('chart').addEventListener('blur', () => syncChartText());

$('bandTracks').addEventListener('input', (e) => {
  const card = e.target.closest('[data-band]');
  if (!card || e.target.dataset.bact !== 'volume') return;
  const v = +e.target.value;
  band()[card.dataset.band].volume = v;
  card.querySelector('.db').textContent = `${v > 0 ? '+' : ''}${v} dB`;
  syncAudio();
  saveDraft();
});
$('bandTracks').addEventListener('change', (e) => {
  const card = e.target.closest('[data-band]');
  if (!card || e.target.dataset.bact !== 'sound') return;
  band()[card.dataset.band].sound = e.target.value;
  syncAudio();
  saveDraft();
});
$('bandTracks').addEventListener('click', (e) => {
  const card = e.target.closest('[data-band]');
  if (!card || e.target.dataset.bact !== 'mute') return;
  const t = band()[card.dataset.band];
  t.mute = !t.mute;
  syncAudio();
  renderBand();
  saveDraft();
});

/** Turn the band's comping and bass into editable parts. */
function writeBandToStaff() {
  if (!hasChords(band())) { setStatus('importStatus', 'Add some chords first.', 'warn'); return; }
  if (state.parts.length + 2 > MAX_PARTS) { setStatus('importStatus', `There's only room for ${MAX_PARTS} parts. Remove a part first.`, 'warn'); return; }
  const g = generateBacking({ bars: band().chart, ts: state.ts, style: band().style, seed: band().seed, ending: true });
  const barLen = Math.round(capQ(state.ts) * 4);
  const maxLen = barLen * band().chart.length;
  const toRaw = (list) => list.flatMap((e) => e.midis.map((m) => {
    const start = Math.round(e.q * 4);
    return { start, end: Math.max(start + 1, Math.round((e.q + e.dur) * 4)), midi: m, spell: e.spell, key: e.chord ? spellInChord(m, e.chord) : null };
  }));
  const st = STYLES[band().style];
  setUndo();
  stopPlayback();
  state.parts.push(
    makePart({ name: `${SOUND_LABELS[band().comp.sound]} (${st.name})`.slice(0, 24), clef: 'treble', sound: band().comp.sound, volume: band().comp.volume, notes: notesFromRaw(toRaw(g.comp), barLen, maxLen) }),
    makePart({ name: 'Bass line', clef: 'bass', sound: band().bass.sound, volume: band().bass.volume, notes: notesFromRaw(toRaw(g.bass), barLen, maxLen) }),
  );
  band().comp.mute = true;
  band().bass.mute = true;
  syncAudio();
  renderBand();
  renderParts();
  commit();
  setStatus('importStatus', 'Added the band\'s comping and bass as parts you can edit. Their band versions are muted so they don\'t double; the drums keep playing.', 'ok');
}
$('bandWrite').addEventListener('click', writeBandToStaff);

// In-place chord editor over a bar.
let editor = null;
let extraBars = 0;
function openChordEditor(bar) {
  closeChordEditor();
  const slot = slots.find((s) => s.bar === bar);
  if (!slot) return;
  const input = document.createElement('input');
  input.className = 'chord-input';
  input.id = 'chordInput';
  input.value = band().chart[bar] || '';
  input.placeholder = 'e.g. Dm7 G7';
  input.setAttribute('aria-label', `Chords for bar ${bar + 1}`);
  input.spellcheck = false;
  Object.assign(input.style, { left: `${slot.x}px`, top: `${slot.y}px`, width: `${Math.max(slot.w, 120)}px` });
  $('score').appendChild(input);
  const ed = { bar, input, done: false };
  editor = ed;
  const finish = (move) => {
    if (ed.done) return;
    ed.done = true;
    if (editor === ed) editor = null;
    const chart = [...band().chart];
    while (chart.length <= bar) chart.push('');
    chart[bar] = input.value.trim();
    const target = Math.max(0, bar + move);
    extraBars = move ? target + 1 : 0; // keep the next bar on screen while tabbing past the end
    setChart(chart);
    if (move) openChordEditor(target);
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); finish(0); }
    else if (e.key === 'Tab') { e.preventDefault(); finish(e.shiftKey ? -1 : 1); }
    else if (e.key === 'Escape') { e.preventDefault(); ed.done = true; editor = null; extraBars = 0; input.remove(); }
  });
  input.addEventListener('blur', () => finish(0));
  input.focus();
  input.select();
}
function closeChordEditor() {
  if (!editor) return;
  editor.done = true;
  editor.input.remove();
  editor = null;
}

// ---------- editing ----------
let lastInsert = { idx: -1, at: 0, pi: -1 };

function insertNote(n) {
  const notes = part().notes;
  const at = state.selected >= 0 ? state.selected + 1 : notes.length;
  notes.splice(at, 0, n);
  if (state.selected >= 0) state.selected = at;
  lastInsert = { idx: at, at: performance.now(), pi: state.active };
  commit();
}

/** Add a pitch to the active part: as a new note, or onto an existing note in chord mode / when grouping a MIDI chord. */
function addPitch(k, { groupWindowMs = 0 } = {}) {
  const notes = part().notes;
  const grouping = groupWindowMs && lastInsert.pi === state.active && performance.now() - lastInsert.at < groupWindowMs && notes[lastInsert.idx];
  if ((state.chord && notes.length) || grouping) {
    const i = grouping ? lastInsert.idx : state.selected >= 0 ? state.selected : notes.length - 1;
    const n = notes[i];
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
  const notes = part().notes;
  if (!notes.length) return;
  const i = state.selected >= 0 ? state.selected : notes.length - 1;
  notes.splice(i, 1);
  if (state.selected >= 0) state.selected = notes.length ? Math.max(0, i - 1) : -1;
  commit();
}

function setDur(d) {
  state.dur = d;
  document.querySelectorAll('[data-dur]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.dur === d)));
  if (state.selected >= 0) { part().notes[state.selected].dur = d; commit(); }
}
function toggleDot() {
  state.dots = state.dots ? 0 : 1;
  $('dotBtn').setAttribute('aria-pressed', String(!!state.dots));
  if (state.selected >= 0) { part().notes[state.selected].dots = state.dots; commit(); }
}
function toggleChord() { state.chord = !state.chord; $('chordBtn').setAttribute('aria-pressed', String(state.chord)); }
/** Tie the selected note (or the last note) to the next one. */
function toggleTie() {
  const notes = part().notes;
  const i = state.selected >= 0 ? state.selected : notes.length - 1;
  if (i < 0 || notes[i].rest) return;
  notes[i].tie = !notes[i].tie;
  if (!notes[i].tie) delete notes[i].tie;
  commit();
}
function setTimeSig(ts) {
  const sel = $('timesig');
  if (![...sel.options].some((o) => o.value === ts)) sel.add(new Option(ts, ts));
  sel.value = ts;
  state.ts = ts;
}
function shiftOct(d) { state.octave = Math.max(1, Math.min(6, state.octave + d)); buildPiano(); }

function setMsg(t, bad) { $('msg').textContent = t; $('msg').classList.toggle('bad', !!bad); }
function setStatus(id, text, tone) { const el = $(id); el.textContent = text; el.dataset.tone = tone || ''; }

async function previewKey(k) {
  if (state.playing) return;
  await audio.unlock();
  audio.preview(part(), [midiOf(k)]);
}

// ---------- on-screen piano ----------
const WHITE = ['c', 'd', 'e', 'f', 'g', 'a', 'b'];
const BLACK_AFTER = [0, 1, 3, 4, 5];
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
  $('pianoFor').textContent = part().name;
  $('pianoFor').style.setProperty('--pc', part().color);
}
function bindKey(el, k) {
  keyElsByMidi.set(midiOf(k), el);
  el.addEventListener('pointerdown', (e) => { e.preventDefault(); previewKey(k); addPitch({ ...k }); });
}
function flashKey(m, on) { keyElsByMidi.get(m)?.classList.toggle('down', on); }

// ---------- playback ----------
let lit = [];
function clearLit() { lit.forEach((i, pi) => noteEls[pi]?.[i]?.classList.remove('is-playing')); lit = []; }

let litChord = null;
function lightChord(key) {
  litChord?.classList.remove('is-playing');
  litChord = key ? chordEls[key] || null : null;
  litChord?.classList.add('is-playing');
}

function currentPlan({ fromQ = 0, ending = true } = {}) {
  return buildPlan({ parts: state.parts, band: state.band, ts: state.ts, bpm: +$('tempo').value, fromQ, ending });
}

async function startPlayback() {
  const bandOn = state.band.on && hasChords(state.band);
  if (!state.parts.some((p) => p.notes.length) && !bandOn) return;
  await audio.unlock();
  // Start from the selected note's time position, applied to every part and the band.
  let fromQ = 0;
  if (state.selected >= 0) fromQ = toEvents(part().notes, 120).events[state.selected]?.q ?? 0;
  const loop = $('loop').checked;
  const plan = currentPlan({ fromQ, ending: !loop });
  clearLit();
  lightChord(null);
  state.playing = true;
  setPlayUI(true);
  audio.play(plan.tracks, {
    total: plan.total,
    marks: plan.marks,
    loop,
    onStep: (pi, i) => {
      const prev = lit[pi];
      if (prev !== undefined) noteEls[pi]?.[prev]?.classList.remove('is-playing');
      if (i >= 0) { noteEls[pi]?.[i]?.classList.add('is-playing'); lit[pi] = i; } else delete lit[pi];
    },
    onMark: lightChord,
    onEnd: () => { clearLit(); lightChord(null); state.playing = false; setPlayUI(false); },
  });
}
function stopPlayback() {
  audio.stop();
  clearLit();
  lightChord(null);
  state.playing = false;
  setPlayUI(false);
}
function togglePlay() { state.playing ? stopPlayback() : startPlayback(); }
function setPlayUI(on) {
  $('playLabel').textContent = on ? 'Stop' : 'Play';
  $('playBtn').setAttribute('aria-label', on ? 'Stop' : 'Play');
  $('playIcon').innerHTML = on ? '<rect x="3" y="3" width="10" height="10" rx="1"/>' : '<path d="M3 1.8v12.4L14 8z"/>';
}

// ---------- import ----------
let undoSnapshot = null;

function snapshot() {
  return structuredClone({
    ts: state.ts, bpm: +$('tempo').value, active: state.active, band: state.band,
    parts: state.parts.map(({ id, ...rest }) => rest),
  });
}

/** Replace the whole piece. parts: [{ name, clef, sound, volume?, mute?, solo?, color?, notes }] */
function applyPiece({ ts, bpm, parts, active = 0, band }) {
  stopPlayback();
  setTimeSig(ts);
  if (band) { state.band = structuredClone(band); renderBand(); }
  if (bpm) { $('tempo').value = bpm; $('tempoVal').textContent = bpm; }
  state.parts = [];
  for (const p of parts) {
    const { color, ...rest } = p;
    state.parts.push(makePart({ volume: 0, mute: false, solo: false, ...rest, ...(color ? { color } : {}) }));
  }
  syncAudio();
  state.active = Math.min(active, state.parts.length - 1);
  state.selected = -1;
  state.octave = part().clef === 'bass' ? 2 : 4;
  buildPiano();
  renderParts();
  commit();
}

async function loadMidi(buffer, label) {
  let midi;
  try { midi = new window.Midi(buffer); } catch {
    setStatus('importStatus', `Couldn't read “${label}” as a MIDI file.`, 'warn');
    $('undoImport').hidden = true;
    return;
  }
  const r = importMidi(midi);
  if (!r.parts.length) {
    setStatus('importStatus', `No notes found in “${label}”.`, 'warn');
    $('undoImport').hidden = true;
    return;
  }
  setUndo();
  applyPiece({ ts: r.ts, bpm: r.bpm, parts: r.parts });
  const extra = r.notes.length ? ` ${r.notes.join('. ')}.` : '';
  setStatus('importStatus', `Opened “${label}”: ${r.parts.length} part${r.parts.length === 1 ? '' : 's'}, ${r.ts} at ${r.bpm} bpm.${extra}`, 'ok');
}

function loadExample(ex) {
  const bin = atob(ex.midi);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  loadMidi(bytes.buffer, ex.title);
}

async function loadExampleList() {
  try {
    const res = await fetch('demos/examples.json');
    if (!res.ok) throw new Error(res.status);
    EXAMPLES = await res.json();
    $('examples').innerHTML = EXAMPLES.map((ex, i) =>
      `<button class="example" type="button" data-ex="${i}"><span>${esc(ex.title)}</span><span class="by">${esc(ex.by)}</span></button>`).join('');
  } catch {
    $('examples').innerHTML = '<span class="hint-drop">Examples need the page served over HTTP.</span>';
  }
}

async function loadFile(file) {
  if (!file) return;
  if (!/\.(mid|midi|smf|kar)$/i.test(file.name)) {
    setStatus('importStatus', `“${file.name}” isn't a MIDI file. Choose a .mid or .midi file.`, 'warn');
    return;
  }
  await loadMidi(await file.arrayBuffer(), file.name);
}

loadExampleList();
$('examples').addEventListener('click', (e) => {
  const b = e.target.closest('[data-ex]');
  if (b) loadExample(EXAMPLES[+b.dataset.ex]);
});
$('importFile').addEventListener('change', async (e) => { await loadFile(e.target.files[0]); e.target.value = ''; });
function setUndo() { undoSnapshot = snapshot(); $('undoImport').hidden = false; }

// ---------- new / demo ----------
const DEFAULT_TEMPO = 108;

/** A fresh piece: blank (one empty part, no chords) or the intro demo. */
function freshPiece(demo) {
  return {
    ts: '4/4', bpm: DEFAULT_TEMPO, active: 0,
    band: { ...defaultBand(), chart: demo ? [...SAMPLE_CHART] : [] },
    parts: demo
      ? SAMPLE_PARTS.map((p) => ({ name: p.name, clef: p.clef, sound: p.sound, volume: p.volume, notes: parse(p.text).notes }))
      : [{ name: 'Part 1', clef: 'treble', sound: 'piano', volume: 0, notes: [] }],
  };
}

function resetTo(demo) {
  setUndo();
  applyPiece(freshPiece(demo));
  state.dots = 0;
  state.chord = false;
  $('dotBtn').setAttribute('aria-pressed', 'false');
  $('chordBtn').setAttribute('aria-pressed', 'false');
  setDur('q');
  setStatus('exportStatus', '');
  setStatus('importStatus', demo
    ? 'Loaded the demo. Undo brings back what you had.'
    : 'Started a blank score. Undo brings back what you had.', 'ok');
}
$('newBtn').addEventListener('click', () => resetTo(false));
$('demoBtn').addEventListener('click', () => resetTo(true));
$('undoImport').addEventListener('click', () => {
  if (!undoSnapshot) return;
  applyPiece(undoSnapshot);
  undoSnapshot = null;
  $('undoImport').hidden = true;
  setStatus('importStatus', 'Undone.', 'ok');
});

// Drag a .mid file anywhere onto the page.
let dragDepth = 0;
const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
document.addEventListener('dragenter', (e) => { if (hasFiles(e)) { dragDepth++; document.body.classList.add('dropping'); } });
document.addEventListener('dragleave', (e) => { if (hasFiles(e) && --dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('dropping'); } });
document.addEventListener('dragover', (e) => { if (hasFiles(e)) e.preventDefault(); });
document.addEventListener('drop', (e) => {
  if (!hasFiles(e)) return;
  e.preventDefault();
  dragDepth = 0;
  document.body.classList.remove('dropping');
  loadFile(e.dataTransfer.files[0]);
});

// ---------- MIDI ----------
async function exportMidi() {
  if (!state.parts.some((p) => p.notes.length) && !(state.band.on && hasChords(state.band))) { setStatus('exportStatus', 'Add some notes or chords first.', 'warn'); return; }
  try {
    const plan = currentPlan();
    const bytes = buildMidiFile(plan, { bpm: +$('tempo').value, ts: state.ts });
    const kind = await saveMidi(bytes);
    const n = plan.tracks.filter((t) => t.key === 'part' || !t.part.mute).length;
    setStatus('exportStatus', `${kind === 'zip' ? 'Saved a .zip with the .mid inside' : 'Saved staff-and-sound.mid'} (${n} track${n === 1 ? '' : 's'}).`, 'ok');
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
        if (!state.playing) { await audio.unlock(); audio.noteOn(part(), m, Math.max(0.2, vel)); }
        addPitch(midiToKey(m, $('spell').value), { groupWindowMs: 70 });
      },
      onNoteOff: (m) => { flashKey(m, false); audio.noteOff(part(), m); },
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
$('tieBtn').addEventListener('click', toggleTie);
$('restBtn').addEventListener('click', addRest);
$('delBtn').addEventListener('click', del);
$('clearBtn').addEventListener('click', () => { stopPlayback(); part().notes = []; state.selected = -1; commit(); });
$('timesig').addEventListener('change', (e) => { setTimeSig(e.target.value); commit(); });
$('octDown').addEventListener('click', () => shiftOct(-1));
$('octUp').addEventListener('click', () => shiftOct(1));
$('spell').addEventListener('change', buildPiano);
$('tempo').addEventListener('input', (e) => { $('tempoVal').textContent = e.target.value; });
$('tempo').addEventListener('change', saveDraft);
$('master').addEventListener('input', (e) => { $('masterVal').textContent = e.target.value; audio.setMasterVolume(+e.target.value); });
$('master').addEventListener('change', saveDraft);
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
  part().notes = r.notes;
  state.selected = -1;
  commit({ keepText: true });
});
$('text').addEventListener('blur', (e) => { if (!e.target.classList.contains('bad')) e.target.value = serialize(part().notes, state.ts); });

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
    case '-': toggleTie(); break;
    case 'r': addRest(); break;
    case 'z': shiftOct(-1); break;
    case 'x': shiftOct(1); break;
    case 'backspace': case 'delete': e.preventDefault(); del(); break;
    case 'escape': select(-1); break;
    case 'arrowleft': e.preventDefault(); select(state.selected < 0 ? part().notes.length - 1 : Math.max(0, state.selected - 1)); break;
    case 'arrowright': e.preventDefault(); if (state.selected >= 0) select(Math.min(part().notes.length - 1, state.selected + 1)); break;
    case 'arrowup': e.preventDefault(); if (state.active > 0) setActive(state.active - 1); break;
    case 'arrowdown': e.preventDefault(); if (state.active < state.parts.length - 1) setActive(state.active + 1); break;
    case ' ': e.preventDefault(); togglePlay(); break;
  }
});

// ---------- boot ----------
const draft = loadDraft();
const source = draft?.parts?.length ? draft : { ts: '4/4', parts: SAMPLE_PARTS, band: { ...defaultBand(), chart: SAMPLE_CHART } };
if (source.band) {
  const d = defaultBand(), b = source.band;
  state.band = {
    ...d, ...b,
    style: STYLES[b.style] ? b.style : d.style,
    chart: Array.isArray(b.chart) ? b.chart.map(String) : [],
    comp: { ...d.comp, ...b.comp }, bass: { ...d.bass, ...b.bass }, drums: { ...d.drums, ...b.drums },
  };
}
state.ts = source.ts || '4/4';
for (const p of source.parts) {
  const r = parse(p.text || '');
  state.parts.push(makePart({
    name: p.name, clef: p.clef || 'treble', sound: SOUND_LABELS[p.sound] ? p.sound : 'piano',
    volume: Number.isFinite(p.volume) ? p.volume : 0, mute: !!p.mute, solo: !!p.solo,
    notes: r.error ? [] : r.notes,
  }));
}
state.active = Math.min(draft?.active || 0, state.parts.length - 1);
if (draft?.bpm) { $('tempo').value = draft.bpm; $('tempoVal').textContent = draft.bpm; }
if (Number.isFinite(draft?.master)) { $('master').value = draft.master; $('masterVal').textContent = draft.master; }
setTimeSig(state.ts);
state.octave = part().clef === 'bass' ? 2 : 4;

audio.loadPiano((s) => {
  const label = { loading: 'Loading piano samples…', ready: 'Piano ready', error: 'Piano samples failed to load; piano parts use a synth' }[s];
  setStatus('soundStatus', label, s === 'ready' ? 'ok' : s === 'error' ? 'warn' : '');
  if (s !== 'loading') syncAudio();
});
syncAudio();
audio.setMasterVolume(+$('master').value);

setDur('q');
buildPiano();
renderParts();
renderBand();
commit();
if (!navigator.requestMIDIAccess) setStatus('midiStatus', 'No Web MIDI in this browser', 'warn');

let resizeTimer;
new ResizeObserver(() => { clearTimeout(resizeTimer); resizeTimer = setTimeout(render, 80); }).observe($('score'));
document.fonts?.ready.then(render);
