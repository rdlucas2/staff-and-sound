// Converts a parsed MIDI file (@tonejs/midi) into parts of notation.
// Rhythms are snapped to a sixteenth-note grid; each part holds one line of notes or chords
// (notes starting together become a chord, an overlapping note is cut where the next one starts).
// Notes that cross a bar line are split and tied.
import { capQ, midiToKey } from './notation.js';

export const MAX_IMPORT_PARTS = 8;
export const MAX_IMPORT_BARS = 64;

// Sixteenths -> [duration, dots], largest first.
const PIECES = [[16, 'w', 0], [12, 'h', 1], [8, 'h', 0], [6, 'q', 1], [4, 'q', 0], [3, '8', 1], [2, '8', 0], [1, '16', 0]];
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
 * Turn a list of {start, end, midi, spell?, key?} (in sixteenths) into notes, splitting at bar lines.
 * key ({ letter, acc, oct }) fixes a note's spelling exactly; spell picks sharps or flats.
 * barLen is in sixteenths; maxLen cuts the part off; spell ('#' or 'b') is the default spelling.
 */
export function notesFromRaw(raw, barLen, maxLen, spell = '#') {
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
    const gapTo = Number.isFinite(next) ? Math.min(next, maxLen) : Math.ceil(end / 4) * 4;
    if (gapTo > end && gapTo - end <= Math.max(1, Math.floor((end - s) * 0.25))) end = gapTo;
    if (s > cursor) segs.push({ start: cursor, len: s - cursor, midis: null });
    const midis = [...new Set(group.map((n) => n.midi))].sort((a, b) => a - b);
    segs.push({ start: s, len: Math.max(1, end - s), midis });
    cursor = s + Math.max(1, end - s);
  });

  const notes = [];
  for (const seg of segs) {
    let pos = seg.start, left = seg.len;
    while (left > 0) {
      const room = barLen - (pos % barLen);
      let chunk = Math.min(left, room);
      while (chunk > 0) {
        const [len, dur, dots] = PIECES.find(([l]) => l <= chunk);
        const note = seg.midis
          ? { keys: seg.midis.map((m) => keyOf.get(m + '@' + seg.start) || midiToKey(m, spellOf.get(m) || spell)), dur, dots, rest: false }
          : { keys: [], dur, dots, rest: true };
        notes.push(note);
        chunk -= len; left -= len; pos += len;
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
