// Freeplay page: a keyboard-only instrument with the synth editor, MIDI input, sustain and drum pads.
import * as audio from './audio.js';
import { connectMidiInput } from './midi.js';
import { defaultPatch, normalizePatch } from './synth.js';
import { mountSynthPanel } from './synth-panel.js';
import { createKeyboard, noteLabel } from './keyboard.js';
import { initSampler, mountSamplerPanel } from './sampler-panel.js';
import { STYLES, PROGRESSIONS } from './band.js';
import { parseChart, chartFromText, chartToText, prettyChord, chordPcs } from './chords.js';
import { buildPlan, BAND_IDS, hasChords } from './plan.js';

const $ = (id) => document.getElementById(id);
const STORE_KEY = 'staff-and-sound:freeplay';
const SOUNDS = {
  synth: 'Synth (editable)', sampler: 'Sampler (your sound)', piano: 'Grand piano', epiano: 'Electric piano', organ: 'Organ', strings: 'Strings',
  guitar: 'Nylon guitar', pluck: 'Pluck synth', chip: 'Chiptune', upright: 'Upright bass', ebass: 'Electric bass',
};
const PADS = [
  ['kick', 'Kick'], ['snare', 'Snare'], ['rim', 'Rim'], ['hhc', 'Closed hat'],
  ['hho', 'Open hat'], ['ride', 'Ride'], ['crash', 'Crash'], ['shaker', 'Shaker'],
];
// Computer keys, as semitones above the hinted C.
const KEYMAP = { a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11, k: 12, o: 13, l: 14, p: 15, ';': 16, "'": 17 };

const TRACKS_KEY = 'staff-and-sound:tracks';     // saved backing tracks
const DRAFT_KEY = 'staff-and-sound:draft:v2';     // the main page's score (read only here)
const HANDOFF_KEY = 'staff-and-sound:handoff';    // chords sent to the main page
const BAND_SOUND_LABELS = { piano: 'Grand piano', epiano: 'Electric piano', guitar: 'Nylon guitar', organ: 'Organ', strings: 'Strings', pluck: 'Pluck synth', chip: 'Chiptune', upright: 'Upright bass', ebass: 'Electric bass' };
const COMP_SOUNDS = ['piano', 'epiano', 'guitar', 'organ', 'strings', 'pluck', 'chip'];
const BASS_SOUNDS = ['upright', 'ebass', 'pluck', 'piano'];
const BAND_COLORS = { comp: '#8c7a3e', bass: '#3f6b8c', drums: '#6f6a7a' };

function bandFor(styleKey, chartText, extra = {}) {
  const st = STYLES[styleKey];
  return {
    style: styleKey, chart: chartFromText(chartText), seed: 1, bpm: st.tempo, loop: true, countIn: 1, tones: true,
    comp: { sound: st.comp, volume: -4, mute: false }, bass: { sound: st.bass, volume: -2, mute: false }, drums: { volume: -6, mute: false },
    ...extra,
  };
}
const defaultBand = () => { const p = PROGRESSIONS.find((x) => x.style === 'bossa') || PROGRESSIONS[0]; return bandFor(p.style, p.chart); };

const state = {
  sound: 'synth', patch: defaultPatch(), octave: 3, span: window.innerWidth < 640 ? 2 : 3,
  transpose: 0, velocity: 75, volume: 80, sustain: false, band: defaultBand(),
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
      band: s.band && STYLES[s.band.style] ? { ...defaultBand(), ...s.band, chart: (s.band.chart || []).map(String) } : state.band,
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
const clickPart = { id: 'fp-click', sound: 'drums', volume: -6, mute: false, solo: false };
const bandChannels = () => [
  { id: BAND_IDS.comp, solo: false, ...state.band.comp },
  { id: BAND_IDS.bass, solo: false, ...state.band.bass },
  { id: BAND_IDS.drums, solo: false, sound: 'drums', ...state.band.drums },
];
const sync = () => audio.syncParts([part(), drums, clickPart, ...bandChannels()]);

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

const samplerPanel = mountSamplerPanel($('fpSamplerPanel'), {
  idPrefix: 'fps',
  onNewSound: () => { panic(); state.sound = 'sampler'; $('fpSound').value = 'sampler'; sync(); showSynth(); save(); },
  preview: (m) => { audio.unlock(); audio.preview({ id: 'free-preview', sound: 'sampler', volume: 0 }, [m], 0.9); },
});
initSampler().then(() => samplerPanel.refresh());


// ---------- backing track ----------
const B = () => state.band;
const tsOf = () => STYLES[B().style].ts;
let bandPlaying = false;
let order = [];      // chord changes in playback order: { key, sym, chord, bar }
let nBars = 0;

function chordHtml(sym) {
  if (!sym) return '–';
  const pc = prettyChord(sym);
  const esc = (x) => x.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  return `${esc(pc.root)}${pc.quality ? `<span class="q">${esc(pc.quality)}</span>` : ''}${pc.bass ? `<span class="b">${esc(pc.bass)}</span>` : ''}`;
}

function chartMessage() {
  const [num, den] = tsOf().split('/').map(Number);
  const { errors } = parseChart(B().chart, num, 4 / den);
  const el = $('fpChartMsg');
  el.textContent = errors.length
    ? `Don't recognize ${errors.slice(0, 3).map((e) => `“${e.token}” (bar ${e.bar + 1})`).join(', ')}. Try forms like Cmaj7, Dm7b5, G7#9 or F/A.`
    : '';
  el.classList.toggle('bad', !!errors.length);
}

function bandTrackCard(key, label, sounds) {
  const t = B()[key];
  const sel = sounds
    ? `<select id="fpb-sound-${key}" data-bact="sound" aria-label="${label} sound">${sounds.map((v) => `<option value="${v}"${v === t.sound ? ' selected' : ''}>${BAND_SOUND_LABELS[v]}</option>`).join('')}</select>`
    : '<span class="band-sub">Drum kit</span>';
  return `<article class="part band-track" data-band="${key}" style="--pc:${BAND_COLORS[key]}" aria-label="${label}">
    <div class="part-head"><span class="chip" aria-hidden="true"></span><span class="band-name">${label}</span></div>
    <div class="part-row">${sel}</div>
    <div class="part-row">
      <input type="range" id="fpb-vol-${key}" data-bact="volume" min="-30" max="6" step="1" value="${t.volume}" aria-label="${label} volume">
      <span class="db">${t.volume > 0 ? '+' : ''}${t.volume} dB</span>
      <button class="ms${t.mute ? ' on' : ''}" type="button" data-bact="mute" aria-pressed="${t.mute}" title="Mute">M</button>
    </div>
  </article>`;
}

function renderBand() {
  const b = B();
  $('fpStyle').value = b.style;
  $('fpStyleDesc').textContent = `${STYLES[b.style].desc} ${tsOf()}.`;
  $('fpTempo').value = b.bpm; $('fpTempoVal').textContent = b.bpm;
  $('fpLoop').checked = b.loop;
  $('fpCount').value = String(b.countIn);
  $('fpTones').checked = b.tones;
  if (document.activeElement !== $('fpChart')) $('fpChart').value = chartToText(b.chart);
  $('fpBandTracks').innerHTML = bandTrackCard('comp', 'Comping', COMP_SOUNDS) + bandTrackCard('bass', 'Bass', BASS_SOUNDS) + bandTrackCard('drums', 'Drums', null);
  chartMessage();
}

function renderSaved(selected = '') {
  const list = loadTracks();
  $('fpSaved').innerHTML = `<option value="">${list.length ? 'Load a saved track…' : 'No saved tracks yet'}</option>` +
    list.map((t, i) => `<option value="${i}"${t.name === selected ? ' selected' : ''}>${t.name.replace(/</g, '&lt;')} · ${STYLES[t.style]?.name || ''}</option>`).join('');
  $('fpDelete').disabled = !selected;
}
function loadTracks() { try { return JSON.parse(localStorage.getItem(TRACKS_KEY) || '[]').filter((t) => t && STYLES[t.style]); } catch { return []; } }
function storeTracks(list) { try { localStorage.setItem(TRACKS_KEY, JSON.stringify(list)); return true; } catch { return false; } }
const setBandStatus = (text, tone) => { const el = $('fpBandStatus'); el.textContent = text; el.dataset.tone = tone || ''; };

function showChord(key) {
  const now = $('fpNowChord'), next = $('fpNextChord'), bar = $('fpNowBar'), box = document.querySelector('.fp-now');
  if (key && String(key).startsWith('count:')) {
    box.classList.add('counting');
    now.textContent = key.slice(6);
    next.innerHTML = chordHtml(order[0]?.sym);
    bar.textContent = 'Count-in';
    return;
  }
  box.classList.remove('counting');
  const i = order.findIndex((o) => o.key === key);
  if (i < 0) {
    now.textContent = '–';
    next.textContent = '–';
    bar.textContent = bandPlaying ? '' : 'Press Play band';
    kb.setTones(null);
    return;
  }
  const cur = order[i];
  const nxt = order[i + 1] || (B().loop ? order[0] : null);
  now.innerHTML = chordHtml(cur.sym);
  next.innerHTML = chordHtml(nxt?.sym);
  bar.textContent = `Bar ${cur.bar + 1} of ${nBars}`;
  if (B().tones && cur.chord) kb.setTones(new Set(chordPcs(cur.chord).map((pc) => ((pc + 12 - state.transpose % 12) % 12))), (cur.chord.root + 12 - state.transpose % 12) % 12);
  else kb.setTones(null);
}

function setBandUI(on) {
  $('fpBandLabel').textContent = on ? 'Stop band' : 'Play band';
  $('fpBandIcon').innerHTML = on ? '<rect x="3" y="3" width="10" height="10" rx="1"/>' : '<path d="M3 1.8v12.4L14 8z"/>';
}

function stopBand() {
  audio.stop();
  bandPlaying = false;
  setBandUI(false);
  showChord(null);
}

function playBand() {
  audio.unlock();
  const b = B();
  if (!hasChords({ chart: b.chart })) { setBandStatus('Write some chords first, or load a progression.', 'warn'); return; }
  const ts = tsOf();
  const [num, den] = ts.split('/').map(Number);
  const plan = buildPlan({ parts: [], band: { ...b, on: true }, ts, bpm: b.bpm, ending: !b.loop });
  nBars = b.chart.length;
  order = [];
  plan.backing.chart.bars.forEach((bar, bi) => bar.chords.forEach((c, k) => { if (!c.bad) order.push({ key: `${bi}:${k}`, sym: c.sym, chord: c.chord, bar: bi }); }));
  const beatSec = (4 / den) * (60 / b.bpm);
  const countBeats = b.countIn * num;
  const intro = [];
  for (let k = 0; k < countBeats; k++) {
    intro.push({ t: k * beatSec, drum: k % num === 0 ? 'clickHi' : 'click', vel: k % num === 0 ? 0.9 : 0.65 });
    intro.push({ t: k * beatSec, mark: `count:${countBeats - k}` });
  }
  sync();
  audio.play(plan.tracks, {
    total: plan.total, marks: plan.marks, loop: b.loop,
    intro: { part: clickPart, events: intro }, introLength: countBeats * beatSec,
    onMark: showChord,
    onEnd: () => { bandPlaying = false; setBandUI(false); showChord(null); },
  });
  bandPlaying = true;
  setBandUI(true);
  setBandStatus('');
}
const restartIfPlaying = () => { if (bandPlaying) { stopBand(); playBand(); } };

function setStyle(key) {
  const st = STYLES[key];
  Object.assign(B(), { style: key, bpm: st.tempo });
  B().comp.sound = st.comp;
  B().bass.sound = st.bass;
  sync();
  renderBand();
  save();
  restartIfPlaying();
}

$('fpStyle').innerHTML = Object.entries(STYLES).map(([k, st]) => `<option value="${k}">${st.name}</option>`).join('');
$('fpProg').innerHTML = '<option value="">Load a progression…</option>' + PROGRESSIONS.map((p, i) => `<option value="${i}">${p.name} · ${STYLES[p.style].name}</option>`).join('');
$('fpBandPlay').addEventListener('click', () => (bandPlaying ? stopBand() : playBand()));
$('fpStyle').addEventListener('change', (e) => setStyle(e.target.value));
$('fpProg').addEventListener('change', (e) => {
  const p = PROGRESSIONS[+e.target.value];
  e.target.value = '';
  if (!p) return;
  B().chart = chartFromText(p.chart);
  setStyle(p.style);
  setBandStatus(`Loaded “${p.name}”.`, 'ok');
});
$('fpVary').addEventListener('click', () => { B().seed = (B().seed % 9973) + 1; save(); restartIfPlaying(); setBandStatus(`Variation ${B().seed}.`, 'ok'); });
$('fpTempo').addEventListener('input', (e) => { B().bpm = +e.target.value; $('fpTempoVal').textContent = e.target.value; save(); });
$('fpTempo').addEventListener('change', restartIfPlaying);
$('fpLoop').addEventListener('change', (e) => { B().loop = e.target.checked; save(); });
$('fpCount').addEventListener('change', (e) => { B().countIn = +e.target.value; save(); });
$('fpTones').addEventListener('change', (e) => { B().tones = e.target.checked; if (!e.target.checked) kb.setTones(null); save(); });
$('fpChart').addEventListener('input', (e) => { B().chart = chartFromText(e.target.value); chartMessage(); save(); });
$('fpChart').addEventListener('change', restartIfPlaying);
$('fpChart').addEventListener('blur', () => { $('fpChart').value = chartToText(B().chart); });
$('fpBandTracks').addEventListener('input', (e) => {
  const card = e.target.closest('[data-band]');
  if (!card || e.target.dataset.bact !== 'volume') return;
  B()[card.dataset.band].volume = +e.target.value;
  card.querySelector('.db').textContent = `${+e.target.value > 0 ? '+' : ''}${e.target.value} dB`;
  sync(); save();
});
$('fpBandTracks').addEventListener('change', (e) => {
  const card = e.target.closest('[data-band]');
  if (!card || e.target.dataset.bact !== 'sound') return;
  B()[card.dataset.band].sound = e.target.value;
  sync(); save();
});
$('fpBandTracks').addEventListener('click', (e) => {
  const card = e.target.closest('[data-band]');
  if (!card || e.target.dataset.bact !== 'mute') return;
  const t = B()[card.dataset.band];
  t.mute = !t.mute;
  sync(); renderBand(); save();
});

// Saved backing tracks.
let lastDeleted = null;
const snapshotBand = (name) => ({ name, ...structuredClone(B()) });
$('fpSave').addEventListener('click', () => {
  const name = $('fpSaveName').value.trim();
  if (!name) { setBandStatus('Type a name for the track first.', 'warn'); $('fpSaveName').focus(); return; }
  if (!hasChords({ chart: B().chart })) { setBandStatus('There are no chords to save yet.', 'warn'); return; }
  const list = loadTracks().filter((t) => t.name !== name);
  list.push(snapshotBand(name));
  list.sort((a, b) => a.name.localeCompare(b.name));
  if (!storeTracks(list)) { setBandStatus('This browser isn\'t letting the page save. Try a regular window.', 'warn'); return; }
  renderSaved(name);
  setBandStatus(`Saved “${name}”.`, 'ok');
});
$('fpSaved').addEventListener('change', (e) => {
  const t = loadTracks()[+e.target.value];
  if (!t) { $('fpDelete').disabled = true; return; }
  const { name, ...band } = structuredClone(t);
  state.band = { ...defaultBand(), ...band };
  $('fpSaveName').value = name;
  $('fpDelete').disabled = false;
  sync(); renderBand(); save(); restartIfPlaying();
  setBandStatus(`Loaded “${name}”.`, 'ok');
});
$('fpDelete').addEventListener('click', () => {
  const list = loadTracks();
  const i = +$('fpSaved').value;
  if (!list[i]) return;
  lastDeleted = list[i];
  list.splice(i, 1);
  storeTracks(list);
  renderSaved();
  setBandStatus(`Deleted “${lastDeleted.name}”.`);
  $('fpUndoDelete').hidden = false;
});
$('fpUndoDelete').addEventListener('click', () => {
  if (!lastDeleted) return;
  const list = loadTracks();
  list.push(lastDeleted);
  list.sort((a, b) => a.name.localeCompare(b.name));
  storeTracks(list);
  renderSaved(lastDeleted.name);
  setBandStatus(`Restored “${lastDeleted.name}”.`, 'ok');
  lastDeleted = null;
  $('fpUndoDelete').hidden = true;
});

// Sharing with the main page.
$('fpFromScore').addEventListener('click', () => {
  let draft = null;
  try { draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch {}
  const band = draft?.band;
  if (!band?.chart?.some((x) => x && x.trim() && x.trim() !== '/')) { setBandStatus('The score on the main page has no chords yet.', 'warn'); return; }
  const style = STYLES[band.style] ? band.style : 'swing';
  state.band = { ...defaultBand(), style, chart: band.chart.map(String), seed: band.seed || 1, bpm: draft.bpm || STYLES[style].tempo,
    comp: { ...defaultBand().comp, ...band.comp, mute: false }, bass: { ...defaultBand().bass, ...band.bass, mute: false }, drums: { ...defaultBand().drums, ...band.drums } };
  sync(); renderBand(); save(); restartIfPlaying();
  setBandStatus(`Loaded the score's ${state.band.chart.length} bars of chords.`, 'ok');
});
$('fpToScore').addEventListener('click', () => {
  if (!hasChords({ chart: B().chart })) { setBandStatus('Write some chords first.', 'warn'); return; }
  try {
    localStorage.setItem(HANDOFF_KEY, JSON.stringify({ at: Date.now(), ...structuredClone(B()) }));
  } catch { setBandStatus('This browser isn\'t letting the page save, so the chords can\'t be passed along.', 'warn'); return; }
  stopBand();
  location.href = 'index.html';
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
renderBand();
renderSaved();
