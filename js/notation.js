// Note model, text notation parser/serializer, and measure layout helpers.
// A note is { keys: [{ letter, acc, oct }], dur: 'w'|'h'|'q'|'8'|'16'|'32', dots: 0|1|2, rest: bool, tie?: bool }.
// tie = tied to the next note (same pitches sound continuously).

export const DUR_Q = { w: 4, h: 2, q: 1, '8': 0.5, '16': 0.25, '32': 0.125 };
const PC = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
const ACC = { '': 0, n: 0, '#': 1, '##': 2, b: -1, bb: -2 };

/** Length of a note in quarter notes, including dots. */
export function durQ(n) {
  let t = DUR_Q[n.dur], add = t;
  for (let i = 0; i < n.dots; i++) { add /= 2; t += add; }
  return t;
}

export const midiOf = (k) => 12 * (k.oct + 1) + PC[k.letter] + ACC[k.acc];
export const pitchStr = (k) => k.letter.toUpperCase() + (k.acc || '') + k.oct;

const SHARP_NAMES = [['c', ''], ['c', '#'], ['d', ''], ['d', '#'], ['e', ''], ['f', ''], ['f', '#'], ['g', ''], ['g', '#'], ['a', ''], ['a', '#'], ['b', '']];
const FLAT_NAMES = [['c', ''], ['d', 'b'], ['d', ''], ['e', 'b'], ['e', ''], ['f', ''], ['g', 'b'], ['g', ''], ['a', 'b'], ['a', ''], ['b', 'b'], ['b', '']];

/** Spell a MIDI note number as a pitch, preferring sharps ('#') or flats ('b'). */
export function midiToKey(m, spell = '#') {
  const [letter, acc] = (spell === 'b' ? FLAT_NAMES : SHARP_NAMES)[((m % 12) + 12) % 12];
  return { letter, acc, oct: Math.floor(m / 12) - 1 };
}

/** Quarter notes per bar for a time signature like "6/8". */
export function capQ(ts) {
  const [n, d] = ts.split('/').map(Number);
  return (n * 4) / d;
}

const PITCH = /^([A-Ga-g])(##|bb|#|b|n)?(\d)$/;
function parsePitch(s) {
  const m = PITCH.exec(s);
  return m ? { letter: m[1].toLowerCase(), acc: m[2] || '', oct: +m[3] } : null;
}

/**
 * Parse text like "C#4/q D4 (C4 E4 G4)/h. r/8 | C4/h~ C4/q".
 * Duration carries over from the previous token when omitted; "|" is optional; "~" ties to the next note.
 * Returns { notes } or { error: offendingToken }.
 */
export function parse(text) {
  const tokens = text.match(/\([^)]*\)\S*|[^\s|]+/g) || [];
  const notes = [];
  let lastDur = 'q';
  for (const tok of tokens) {
    const m = /^(\([^)]*\)|[^/~]+)(?:\/(w|h|q|8|16|32)(\.{0,2}))?(~)?$/.exec(tok);
    if (!m) return { error: tok };
    const head = m[1], dur = m[2] || lastDur, dots = (m[3] || '').length, tie = !!m[4];
    lastDur = dur;
    if (/^r$/i.test(head)) { notes.push({ keys: [], dur, dots, rest: true }); continue; }
    const parts = head.startsWith('(') ? head.slice(1, -1).trim().split(/\s+/) : [head];
    const keys = parts.map(parsePitch);
    if (!keys.length || keys.some((k) => !k)) return { error: tok };
    notes.push(tie ? { keys, dur, dots, rest: false, tie } : { keys, dur, dots, rest: false });
  }
  return { notes };
}

/** Serialize notes back to text, with bar lines and four bars per line. */
export function serialize(notes, ts) {
  const cap = capQ(ts);
  const bits = [];
  let used = 0, last = null;
  for (const n of notes) {
    const d = durQ(n);
    if (used > 0 && used + d > cap + 1e-9) { bits.push('|'); used = 0; }
    const head = n.rest ? 'r' : n.keys.length > 1 ? '(' + n.keys.map(pitchStr).join(' ') + ')' : pitchStr(n.keys[0]);
    const durPart = n.dur !== last || n.dots ? '/' + n.dur + '.'.repeat(n.dots) : '';
    last = n.dots ? null : n.dur;
    bits.push(head + durPart + (n.tie && !n.rest ? '~' : ''));
    used += d;
    if (used >= cap - 1e-9) { bits.push('|'); used = 0; }
  }
  if (bits[bits.length - 1] === '|') bits.pop();
  let bars = 0, s = '';
  bits.forEach((b, i) => {
    if (b === '|') { bars++; s += bars % 4 === 0 ? ' |\n' : ' | '; }
    else s += (i && bits[i - 1] !== '|' ? ' ' : '') + b;
  });
  return s;
}

/** Group note indexes into bars. A note that doesn't fit the current bar starts the next one. */
export function toMeasures(notes, ts) {
  const cap = capQ(ts), out = [];
  let cur = [], used = 0;
  notes.forEach((n, i) => {
    const d = durQ(n);
    if (used > 0 && used + d > cap + 1e-9) { out.push(cur); cur = []; used = 0; }
    cur.push(i); used += d;
    if (used >= cap - 1e-9) { out.push(cur); cur = []; used = 0; }
  });
  if (cur.length) out.push(cur);
  return out;
}

const samePitches = (a, b) => a.keys.length === b.keys.length && a.keys.every((k, j) => midiOf(k) === midiOf(b.keys[j]));

/** True when note i is the continuation of a tie from note i-1 (same pitches). */
export function isTiedFrom(notes, i) {
  const a = notes[i - 1], b = notes[i];
  return !!(a && b && a.tie && !a.rest && !b.rest && samePitches(a, b));
}

/**
 * Turn notes into timed events (seconds) for playback or MIDI export.
 * Tied notes sound as one: the first event's duration covers the whole chain, and the
 * continuation notes get silent events (midis: []) so highlighting still follows along.
 */
export function toEvents(notes, bpm, from = 0) {
  const spq = 60 / bpm;
  const events = [];
  let t = 0, head = null;
  for (let i = from; i < notes.length; i++) {
    const n = notes[i], d = durQ(n) * spq;
    if (head && isTiedFrom(notes, i)) {
      head.dur += d;
      events.push({ i, t, dur: d, midis: [], cont: true });
    } else {
      head = { i, t, dur: d, midis: n.rest ? [] : n.keys.map(midiOf) };
      events.push(head);
      if (n.rest) head = null;
    }
    t += d;
  }
  return { events, total: t };
}
