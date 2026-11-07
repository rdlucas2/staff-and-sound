// Chord symbols and chord charts.
//
// parseChord('Dm7b5/Ab') -> { sym, root, bass, tones, family, flats }
//   root, bass: pitch classes (0 = C)
//   tones: semitones above the root: { third, fifth, seventh, sixth, nine, sharpNine, eleven, thirteen } (null when absent)
//   family: 'maj' | 'min' | 'dom' | 'hdim' | 'dim' | 'aug' | 'sus' | 'power'
//
// A chart is an array of bar strings, e.g. ['Dm7 G7', 'Cmaj7', '%', 'Dm7 / G7 /'].

const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const ACC = { '': 0, '#': 1, b: -1, '♯': 1, '♭': -1 };

function normalizeQuality(raw) {
  let s = raw.replace(/[\s(),]/g, '').replace(/♭/g, 'b').replace(/♯/g, '#');
  if (s === 'Δ' || s === '△') return 'maj7';
  s = s.replace(/[Δ△]/g, 'maj');
  s = s.replace(/^[øØ]7?/, 'm7b5');
  s = s.replace(/^(°|o)7/, 'dim7').replace(/^(°|o)$/, 'dim');
  s = s.replace(/^(m|-)M(aj|a)?/, 'mmaj');
  if (/^(MA|Ma|M)(?=\d)/.test(s)) s = s.replace(/^(MA|Ma|M)/, 'maj');
  else if (s === 'M') s = '';
  s = s.toLowerCase();
  s = s.replace(/^(min|mi|-)/, 'm').replace(/^ma(?=\d)/, 'maj');
  s = s.replace(/^\+/, 'aug');
  s = s.replace(/\+(?=5|9|11)/g, '#').replace(/\+$/, '#5');
  s = s.replace(/-(?=5|9|13)/g, 'b');
  return s;
}

function parseQuality(raw) {
  const s = normalizeQuality(raw);
  let i = 0;
  const take = (re) => {
    const m = re.exec(s.slice(i));
    if (m) i += m[0].length;
    return m;
  };
  const r = {
    third: 4, fifth: 7, seventh: false, majSeventh: false, dim: false, sixth: false,
    nine: null, sharpNine: null, eleven: null, thirteen: null, sus: null, alt: false,
  };

  if (take(/^mmaj/)) { r.third = 3; r.majSeventh = true; }
  else if (take(/^maj/)) { r.majSeventh = true; }
  else if (take(/^m(?!aj)/)) { r.third = 3; }
  else if (take(/^dim/)) { r.third = 3; r.fifth = 6; r.dim = true; }
  else if (take(/^aug/)) { r.fifth = 8; }

  const num = take(/^(69|13|11|9|7|6|5)/);
  if (num) {
    switch (num[1]) {
      case '5': r.third = null; break;
      case '6': r.sixth = true; break;
      case '69': r.sixth = true; r.nine = 14; break;
      case '7': r.seventh = true; break;
      case '9': r.seventh = true; r.nine = 14; break;
      case '11': r.seventh = true; r.nine = 14; r.eleven = 17; break;
      case '13': r.seventh = true; r.nine = 14; r.thirteen = 21; break;
    }
  }
  // A bare "maj" (no number) is just a major triad.
  if (r.majSeventh && !r.seventh) r.majSeventh = false;

  while (i < s.length) {
    let m;
    if ((m = take(/^sus(2|4)?/))) { r.sus = m[1] === '2' ? 2 : 5; continue; }
    if ((m = take(/^(13|11|9|7)/))) { // e.g. Csus7, Csus4add9 written oddly
      r.seventh = true;
      if (m[1] !== '7') r.nine = 14;
      if (m[1] === '13') r.thirteen = 21;
      continue;
    }
    if ((m = take(/^add(#11|b9|#9|13|11|9|4|2)/))) {
      const a = m[1];
      if (a === '9' || a === '2') r.nine = 14;
      else if (a === 'b9') r.nine = 13;
      else if (a === '#9') r.sharpNine = 15;
      else if (a === '11' || a === '4') r.eleven = 17;
      else if (a === '#11') r.eleven = 18;
      else if (a === '13') r.thirteen = 21;
      continue;
    }
    if ((m = take(/^(b|#)(5|9|11|13)/))) {
      const [, acc, deg] = m;
      if (deg === '5') r.fifth = acc === 'b' ? 6 : 8;
      if (deg === '9') { if (acc === 'b') r.nine = 13; else r.sharpNine = 15; }
      if (deg === '11') r.eleven = acc === '#' ? 18 : 16;
      if (deg === '13') r.thirteen = acc === 'b' ? 20 : 21;
      if (!r.sixth && !r.majSeventh) r.seventh = true; // C7b9, C#11 imply a seventh
      continue;
    }
    if (take(/^alt/)) { r.alt = true; r.seventh = true; continue; }
    if (take(/^no3/)) { r.third = null; continue; }
    return null; // something we don't understand
  }

  if (r.alt) { r.nine = 13; r.sharpNine = 15; r.thirteen = 20; r.fifth = null; }
  const third = r.sus ?? r.third;
  let seventh = null;
  if (r.seventh || r.majSeventh) seventh = r.majSeventh ? 11 : r.dim ? 9 : 10;
  const tones = {
    third, fifth: r.fifth, seventh, sixth: r.sixth ? 9 : null,
    nine: r.nine, sharpNine: r.sharpNine, eleven: r.eleven, thirteen: r.thirteen,
  };
  let family = 'maj';
  if (third === null) family = 'power';
  else if (r.sus) family = 'sus';
  else if (r.dim && seventh === 9) family = 'dim';
  else if (third === 3 && r.fifth === 6 && seventh === 10) family = 'hdim';
  else if (r.dim) family = 'dim';
  else if (third === 3) family = 'min';
  else if (seventh === 10) family = 'dom';
  else if (r.fifth === 8) family = 'aug';
  return { tones, family };
}

/** Parse one chord symbol. Returns null if it isn't one. */
export function parseChord(sym) {
  const clean = sym.trim().replace(/6\/9/, '69');
  const m = /^([A-G])([#b♯♭]?)([^/]*)(?:\/([A-G])([#b♯♭]?))?$/.exec(clean);
  if (!m) return null;
  const q = parseQuality(m[3]);
  if (!q) return null;
  const root = (LETTER_PC[m[1]] + ACC[m[2]] + 12) % 12;
  const bass = m[4] ? (LETTER_PC[m[4]] + ACC[m[5]] + 12) % 12 : root;
  // Spell chord tones with flats for flat roots, F, and minor-ish chords on D, G and C.
  const flats = m[2] === 'b' || m[2] === '♭' || (m[1] === 'F' && !m[2]) ||
    ((q.family === 'min' || q.family === 'hdim' || q.family === 'dim') && 'DGC'.includes(m[1]) && !m[2]);
  return { sym, root, bass, flats, rootLetter: m[1], ...q };
}

const LETTERS = ['c', 'd', 'e', 'f', 'g', 'a', 'b'];
const NATURAL_PC = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

/**
 * Spell a MIDI note by its role in the chord, so a 7th over C is a B-something (B♭ in C7),
 * a 3rd over A is a C-something (C♯ in A7), and so on. Returns { letter, acc, oct }.
 */
export function spellInChord(m, chord) {
  const iv = (((m - chord.root) % 12) + 12) % 12;
  const t = chord.tones;
  const DEGREE = {
    0: 1, 1: 2, 2: 2, 3: 3, 4: 3, 5: 4, // a #9 is written as a minor 3rd, the way most charts show it
    6: t.fifth === 6 ? 5 : 4, 7: 5, 8: t.fifth === 8 ? 5 : 6, 9: t.seventh === 9 ? 7 : 6, 10: 7, 11: 7,
  };
  const li = (LETTERS.indexOf(chord.rootLetter.toLowerCase()) + DEGREE[iv] - 1) % 7;
  const letter = LETTERS[li];
  let acc = (((m % 12) - NATURAL_PC[letter]) % 12 + 12) % 12;
  if (acc > 6) acc -= 12;
  if (Math.abs(acc) > 1) return null; // avoid double sharps and flats; caller falls back to plain spelling
  const ACC_STR = { '-2': 'bb', '-1': 'b', 0: '', 1: '#', 2: '##' };
  return { letter, acc: ACC_STR[acc], oct: Math.floor((m - acc) / 12) - 1 };
}

/** Chord tones as pitch classes (root included), for bass lines. */
export function chordPcs(c) {
  const t = c.tones;
  return [0, t.third, t.fifth, t.seventh ?? t.sixth].filter((x) => x !== null && x !== undefined).map((x) => (c.root + x) % 12);
}

const isNoChord = (tok) => /^(n\.?c\.?)$/i.test(tok);

/**
 * Resolve a chart into timed chords.
 * bars: string[]; slotsPerBar: beats per bar (numerator); slotQ: quarter notes per beat.
 * Returns { bars: [{ chords: [{ sym, chord, slot, slots, q, dur, bad }] }], errors: [{ bar, token }], segments }
 * where segments is a flat list of { bar, q, dur, chord|null } covering the whole chart
 * (a bar with no chords continues the previous one).
 */
export function parseChart(bars, slotsPerBar, slotQ) {
  const out = [];
  const errors = [];
  let prevBarChords = [];
  bars.forEach((text, b) => {
    const raw = (text || '').trim();
    let toks = raw ? raw.split(/\s+/) : [];
    if (toks.length === 1 && toks[0] === '%') {
      out.push({ chords: prevBarChords.map((c) => ({ ...c, q: b * slotsPerBar * slotQ + c.slot * slotQ, repeat: true })) });
      return;
    }
    const chords = [];
    if (toks.includes('/')) {
      toks = toks.slice(0, slotsPerBar);
      toks.forEach((tok, k) => {
        if (tok === '/') { if (chords.length) chords[chords.length - 1].slots += 1; return; }
        chords.push({ tok, slot: k, slots: 1 });
      });
      if (chords.length) {
        const last = chords[chords.length - 1];
        last.slots = slotsPerBar - last.slot;
      }
    } else if (toks.length) {
      const n = Math.min(toks.length, slotsPerBar);
      const base = Math.floor(slotsPerBar / n), extra = slotsPerBar % n;
      let slot = 0;
      toks.slice(0, n).forEach((tok, k) => {
        const slots = base + (k < extra ? 1 : 0);
        chords.push({ tok, slot, slots });
        slot += slots;
      });
    }
    const resolved = chords.map(({ tok, slot, slots }) => {
      const nc = isNoChord(tok);
      const chord = nc ? null : parseChord(tok);
      if (!nc && !chord) errors.push({ bar: b, token: tok });
      return { sym: nc ? 'N.C.' : tok, chord, nc, bad: !nc && !chord, slot, slots, q: (b * slotsPerBar + slot) * slotQ, dur: slots * slotQ };
    });
    out.push({ chords: resolved });
    if (resolved.length) prevBarChords = resolved;
  });

  // Flat timeline. Unknown symbols continue the previous chord.
  const segments = [];
  let current = null;
  const barQ = slotsPerBar * slotQ;
  out.forEach((bar, b) => {
    const starts = bar.chords.filter((c) => !c.bad);
    if (!starts.length || starts[0].slot > 0) {
      const end = starts.length ? starts[0].slot * slotQ : barQ;
      segments.push({ bar: b, q: b * barQ, dur: end, chord: current, cont: true });
    }
    starts.forEach((c, k) => {
      const end = k + 1 < starts.length ? starts[k + 1].slot * slotQ : barQ;
      current = c.chord;
      segments.push({ bar: b, q: b * barQ + c.slot * slotQ, dur: end - c.slot * slotQ, chord: current, cont: false });
    });
  });
  return { bars: out, errors, segments };
}

/** Text area <-> bars. Lines and "|" both separate bars. */
export function chartFromText(text) {
  const bars = [];
  for (const line of text.split('\n')) {
    const t = line.trim();
    if (!t) continue;
    const inner = t.replace(/^\|/, '').replace(/\|$/, '');
    for (const bar of inner.split('|')) bars.push(bar.trim());
  }
  while (bars.length && !bars[bars.length - 1]) bars.pop();
  return bars;
}

export function chartToText(bars) {
  const lines = [];
  // An empty bar (chord carries on) is written as "/".
  for (let i = 0; i < bars.length; i += 4) lines.push(bars.slice(i, i + 4).map((b) => b || '/').join(' | '));
  return lines.join(' |\n');
}

/** Pretty pieces for display: { root, quality, bass }, with ♭/♯. */
export function prettyChord(sym) {
  if (/^n\.?c\.?$/i.test(sym)) return { root: 'N.C.', quality: '', bass: '' };
  const m = /^([A-G])([#b♯♭]?)([^/]*)(?:\/(.+))?$/.exec(sym);
  if (!m) return { root: sym, quality: '', bass: '' };
  const acc = (s) => s.replace(/#/g, '♯').replace(/b(?=\d|$)/g, '♭');
  return { root: m[1] + acc(m[2]), quality: acc(m[3]), bass: m[4] ? '/' + m[4].replace(/#/g, '♯').replace(/b/g, '♭') : '' };
}
