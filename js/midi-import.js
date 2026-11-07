// Converts a parsed MIDI file (@tonejs/midi) into parts of notation.
// Rhythms are snapped to a sixteenth-note grid; each part holds one line of notes or chords
// (notes starting together become a chord, an overlapping note is cut where the next one starts).
// Notes that cross a bar line are split and tied.
import { capQ, midiToKey } from './notation.js';

export const MAX_IMPORT_PARTS = 8;
export const MAX_IMPORT_BARS = 64;

// Written durations, in quarter notes, largest first.
const PIECES_Q = [
  [4, 'w', 0], [3, 'h', 1], [2, 'h', 0], [1.5, 'q', 1], [1, 'q', 0], [2 / 3, 'q', 0, true],
  [0.75, '8', 1], [0.5, '8', 0], [1 / 3, '8', 0, true], [0.25, '16', 0], [1 / 6, '16', 0, true],
];

/** Pieces usable on a grid of `unitsPerQ` units per quarter, every length a multiple of `grid` units. */
function piecesFor(unitsPerQ, grid) {
  return PIECES_Q.map(([q, dur, dots, trip]) => ({ len: q * unitsPerQ, dur, dots, trip: !!trip }))
    .filter((p) => Math.abs(p.len - Math.round(p.len)) < 1e-9 && Math.round(p.len) % grid === 0)
    .map((p) => ({ ...p, len: Math.round(p.len) }));
}

/**
 * Split a length into written durations starting at `pos`: triplets only on triplet positions and
 * within one beat, straight values only on sixteenth positions. Returns null if impossible.
 */
function decompose(pos, len, pieces, unitsPerQ) {
  const tripStep = unitsPerQ / 3, straightStep = unitsPerQ / 4;
  const fits = (pc, p) => pc.trip
    ? Number.isInteger(tripStep) && p % Math.min(pc.len, tripStep) === 0 && Math.floor(p / unitsPerQ) === Math.floor((p + pc.len - 1) / unitsPerQ)
    : !Number.isInteger(straightStep) || p % straightStep === 0;
  const memo = new Map();
  const go = (p, l) => {
    if (l === 0) return [];
    const key = p + ':' + l;
    if (memo.has(key)) return memo.get(key);
    let found = null;
    for (const pc of pieces) {
      if (pc.len > l || !fits(pc, p)) continue;
      const rest = go(p + pc.len, l - pc.len);
      if (rest) { found = [pc, ...rest]; break; }
    }
    memo.set(key, found);
    return found;
  };
  return go(pos, len);
}
const SUPPORTED_DENOMS = new Set([2, 4, 8]);

/** Pick one of our sounds from a General MIDI program number. */
function soundFor(program) {
  if (program >= 16 && program <= 23) return 'organ';
  if (program >= 24 && program <= 39) return 'pluck';
  if (program >= 40 && program <= 55) return 'strings';
  if (program >= 80 && program <= 87) return 'chip';
  if (program >= 104 && program <= 111) return 'pluck';
  return 'piano';
}

/** Flats for flat keys, sharps otherwise. */
function spellingFor(header) {
  const ks = header.keySignatures?.[0];
  if (!ks) return '#';
  const flatMajors = ['F', 'Bb', 'Eb', 'Ab', 'Db', 'Gb', 'Cb'];
  const flatMinors = ['d', 'g', 'c', 'f', 'bb', 'eb', 'ab'];
  const key = ks.key || '';
  return ks.scale === 'minor' ? (flatMinors.includes(key.toLowerCase()) ? 'b' : '#') : (flatMajors.includes(key) ? 'b' : '#');
}

/**
 * Turn a list of {start, end, midi, spell?, key?, vel?} into notes, splitting at bar lines with ties.
 * Times are in units of 1/unitsPerQ of a quarter note (default 4 = sixteenths); barLen and maxLen too.
 * grid: the smallest step in units (lengths are multiples of it); use unitsPerQ 12 for triplet grids.
 * key ({ letter, acc, oct }) fixes a note's spelling exactly; spell ('#' or 'b') is the default spelling.
 */
export function notesFromRaw(raw, barLen, maxLen, spell = '#', { unitsPerQ = 4, grid = 1 } = {}) {
  const pieces = piecesFor(unitsPerQ, grid);
  const spellOf = new Map();
  const keyOf = new Map(); // explicit spellings, per note and onset
  // Group by onset into chords.
  const byStart = new Map();
  for (const n of raw) {
    if (n.start >= maxLen) continue;
    if (!byStart.has(n.start)) byStart.set(n.start, []);
    byStart.get(n.start).push(n);
    if (n.spell) spellOf.set(n.midi, n.spell);
    if (n.key) keyOf.set(n.midi + '@' + n.start, n.key);
  }
  const starts = [...byStart.keys()].sort((a, b) => a - b);
  const segs = []; // { start, len, midis | null for rest }
  let cursor = 0;
  starts.forEach((s, k) => {
    const group = byStart.get(s);
    const next = k + 1 < starts.length ? starts[k + 1] : Infinity;
    let end = Math.min(Math.max(...group.map((n) => n.end)), next, maxLen);
    // Close small gaps from early releases so a slightly short note doesn't leave a tiny rest.
    const gapTo = Number.isFinite(next) ? Math.min(next, maxLen) : Math.ceil(end / unitsPerQ) * unitsPerQ;
    if (gapTo > end && gapTo - end <= Math.max(grid, Math.floor((end - s) * 0.25))) end = gapTo;
    if (s > cursor) segs.push({ start: cursor, len: s - cursor, midis: null });
    const midis = [...new Set(group.map((n) => n.midi))].sort((a, b) => a - b);
    const vels = group.map((n) => n.vel).filter((v) => v !== undefined);
    const len = Math.max(grid, end - s);
    segs.push({ start: s, len, midis, vel: vels.length ? vels.reduce((a, b) => a + b, 0) / vels.length : undefined });
    cursor = s + len;
  });

  const notes = [];
  for (const seg of segs) {
    let pos = seg.start, left = seg.len;
    while (left > 0) {
      const room = barLen - (pos % barLen);
      const chunk = Math.min(left, room);
      const parts = decompose(pos % barLen, chunk, pieces, unitsPerQ)
        || decompose(pos % barLen, chunk, piecesFor(unitsPerQ, 1), unitsPerQ)
        || [];
      if (!parts.length) { left -= chunk; pos += chunk; continue; } // can't be written; skip it
      for (const pc of parts) {
        const note = seg.midis
          ? { keys: seg.midis.map((m) => keyOf.get(m + '@' + seg.start) || midiToKey(m, spellOf.get(m) || spell)), dur: pc.dur, dots: pc.dots, rest: false }
          : { keys: [], dur: pc.dur, dots: pc.dots, rest: true };
        if (pc.trip) note.trip = true;
        if (seg.midis && seg.vel !== undefined) note.vel = seg.vel;
        notes.push(note);
        left -= pc.len; pos += pc.len;
        if (seg.midis && left > 0) note.tie = true;
      }
    }
  }
  // Drop trailing rests.
  while (notes.length && notes[notes.length - 1].rest) notes.pop();
  return notes;
}

/**
 * midi: a Midi instance from @tonejs/midi.
 * Returns { ts, bpm, parts: [{ name, clef, sound, notes }], notes: string[] }
 * where `notes` are short messages about what was simplified.
 */
export function importMidi(midi) {
  const header = midi.header;
  const ppq = header.ppq || 480;
  const sixteenth = ppq / 4;
  const msgs = [];

  let [num, den] = header.timeSignatures?.[0]?.timeSignature || [4, 4];
  if (!SUPPORTED_DENOMS.has(den) || num < 1 || num > 12) { msgs.push(`Time signature ${num}/${den} shown as 4/4`); num = 4; den = 4; }
  const ts = `${num}/${den}`;
  const bpmRaw = header.tempos?.[0]?.bpm || 120;
  const bpm = Math.round(Math.min(220, Math.max(40, bpmRaw)));
  if (header.tempos?.length > 1) msgs.push('Tempo changes ignored');
  const barLen = Math.round(capQ(ts) * 4);
  const maxLen = barLen * MAX_IMPORT_BARS;
  const spell = spellingFor(header);

  const q = (ticks) => Math.round(ticks / sixteenth);
  const candidates = [];
  midi.tracks.forEach((track, ti) => {
    if (!track.notes.length) return;
    if (track.instrument?.percussion || track.channel === 9) { msgs.push(`Skipped drum track "${track.name || ti + 1}"`); return; }
    const raw = track.notes.map((n) => {
      const start = q(n.ticks);
      return { start, end: Math.max(start + 1, q(n.ticks + n.durationTicks)), midi: n.midi };
    });
    const name = (track.name || track.instrument?.name || `Track ${ti + 1}`).trim().slice(0, 24) || `Track ${ti + 1}`;
    const sound = soundFor(track.instrument?.number ?? 0);
    // A wide-ranging track using both sides of middle C (a two-hand piano part) is split onto two staves.
    const upper = raw.filter((n) => n.midi >= 60), lower = raw.filter((n) => n.midi < 60);
    const range = Math.max(...raw.map((n) => n.midi)) - Math.min(...raw.map((n) => n.midi));
    if (range >= 25 && upper.length >= raw.length * 0.15 && lower.length >= raw.length * 0.15 && raw.length >= 8) {
      candidates.push({ name: `${name} (upper)`.slice(0, 24), raw: upper, sound, clef: 'treble' });
      candidates.push({ name: `${name} (lower)`.slice(0, 24), raw: lower, sound, clef: 'bass' });
    } else {
      const avg = raw.reduce((s, n) => s + n.midi, 0) / raw.length;
      candidates.push({ name, raw, sound, clef: avg < 60 ? 'bass' : 'treble' });
    }
  });

  if (candidates.length > MAX_IMPORT_PARTS) msgs.push(`Kept the first ${MAX_IMPORT_PARTS} of ${candidates.length} parts`);
  const longest = Math.max(0, ...candidates.flatMap((c) => c.raw.map((n) => n.end)));
  if (longest > maxLen) msgs.push(`Cut to the first ${MAX_IMPORT_BARS} bars`);
  const overlaps = candidates.some((c) => {
    const s = [...c.raw].sort((a, b) => a.start - b.start);
    return s.some((n, i) => i && n.start > s[i - 1].start && n.start < s[i - 1].end - 1);
  });
  if (overlaps) msgs.push('Overlapping notes were shortened');

  const parts = candidates.slice(0, MAX_IMPORT_PARTS)
    .map((c) => ({ name: c.name, clef: c.clef, sound: c.sound, notes: notesFromRaw(c.raw, barLen, maxLen, spell) }))
    .filter((p) => p.notes.length);

  return { ts, bpm, parts, notes: msgs };
}
