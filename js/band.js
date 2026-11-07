// Backing band: turns a chord chart into comping, bass and drum parts in a chosen style.
// Everything is in quarter notes from the top of the chart ("q"); swing is applied later, at playback.
// Variation comes from a seeded random generator, so the same seed always gives the same performance.
import { parseChart, chordPcs, spellInChord } from './chords.js';

export const STYLES = {
  swing: { name: 'Jazz swing', ts: '4/4', tempo: 140, swing: 0.64, comp: 'piano', bass: 'upright', voicing: 'jazz',
    desc: 'Walking bass, ride cymbal, Charleston-style piano. Swung eighths.' },
  bossa: { name: 'Bossa nova', ts: '4/4', tempo: 128, swing: 0.5, comp: 'guitar', bass: 'upright', voicing: 'jazz',
    desc: 'Nylon guitar, cross-stick clave, shaker. Straight eighths.' },
  waltz: { name: 'Jazz waltz', ts: '3/4', tempo: 150, swing: 0.62, comp: 'piano', bass: 'upright', voicing: 'jazz',
    desc: 'Swing in three, walking bass. Swung eighths.' },
  ballad: { name: 'Ballad', ts: '4/4', tempo: 72, swing: 0.5, comp: 'epiano', bass: 'upright', voicing: 'jazz',
    desc: 'Sustained electric piano, soft cross-stick and hi-hat.' },
  pop: { name: 'Pop / rock', ts: '4/4', tempo: 104, swing: 0.5, comp: 'piano', bass: 'ebass', voicing: 'triad',
    desc: 'Driving eighths and a backbeat snare.' },
  funk: { name: 'Funk', ts: '4/4', tempo: 96, swing: 0.5, comp: 'epiano', bass: 'ebass', voicing: 'jazz',
    desc: 'Sixteenth-note hi-hats, syncopated stabs and bass.' },
};

// General MIDI drum notes (channel 10).
export const GM_DRUMS = { kick: 36, rim: 37, snare: 38, hhc: 42, hhp: 44, hho: 46, crash: 49, ride: 51, shaker: 70 };
const DRUM_VOICE = { hhc: 'hh', hho: 'hh', hhp: 'hh' };

const COMP_RANGE = { jazz: { lo: 50, hi: 74, center: 62 }, triad: { lo: 52, hi: 76, center: 63 } };
const BASS_LO = 33, BASS_HI = 55, BASS_HOME = 40;

// ---------- random ----------
function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const barRandom = (seed, bar, salt) => mulberry32((Math.imul(seed, 2654435761) + bar * 40503 + salt * 977) >>> 0);
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const human = (r, v) => Math.max(0.05, Math.min(1, v * (0.94 + r() * 0.12)));

// ---------- voicings ----------
function compPcs(chord, kind, r) {
  const t = chord.tones;
  const rel = [];
  if (chord.family === 'power') rel.push(0, 7);
  else if (kind === 'triad') {
    rel.push(0, t.third, t.fifth ?? 7);
    if (t.seventh !== null) rel.push(t.seventh);
    else if (t.sixth !== null) rel.push(t.sixth);
    else if (t.nine !== null) rel.push(t.nine);
  } else if (chord.family === 'dim' && t.seventh !== null) {
    rel.push(0, 3, 6, 9);
  } else {
    // Rootless jazz voicing: guide tones (3rd and 7th) plus colors; the bass has the root.
    const guide7 = t.seventh ?? t.sixth;
    rel.push(t.third);
    if (guide7 !== null) rel.push(guide7);
    else rel.push(chord.family === 'min' ? 7 : chord.family === 'aug' ? 0 : 9); // triads get a 6th (6/9 sound)
    let nine = t.nine ?? (t.sharpNine !== null ? t.sharpNine : null);
    if (nine === null && ['maj', 'min', 'dom', 'sus'].includes(chord.family)) nine = 14;
    rel.push(nine ?? (chord.family === 'hdim' ? 17 : 0));
    if (t.sharpNine !== null && t.nine !== null) rel.push(t.sharpNine);
    let top;
    if (t.thirteen !== null) top = t.thirteen;
    else if (chord.family === 'dom' && t.fifth === 7 && r() < 0.5) top = 21;
    else top = t.fifth ?? 7;
    rel.push(top);
    if (t.eleven !== null) rel.push(t.eleven);
  }
  return [...new Set(rel.filter((x) => x !== null && x !== undefined).map((x) => (chord.root + x) % 12))];
}

/** Close-position voicing of the pitch classes that moves least from the previous one. */
function voiceLead(pcs, prev, { lo, hi, center }) {
  const sorted = [...pcs].sort((a, b) => a - b);
  let best = null, bestScore = Infinity;
  for (let k = 0; k < sorted.length; k++) {
    const order = sorted.slice(k).concat(sorted.slice(0, k));
    for (let base = lo; base < lo + 12; base++) {
      if (base % 12 !== order[0]) continue;
      const v = [base];
      for (let j = 1; j < order.length; j++) {
        let n = v[j - 1] + 1;
        while (n % 12 !== order[j]) n++;
        v.push(n);
      }
      if (v[v.length - 1] > hi) continue;
      let score = 0;
      if (prev?.length) {
        score += v.reduce((s, n) => s + Math.min(...prev.map((p) => Math.abs(p - n))), 0) / v.length;
        score += Math.abs(v[v.length - 1] - prev[prev.length - 1]) * 0.35;
      }
      score += Math.abs((v[0] + v[v.length - 1]) / 2 - center) * 0.25;
      if (score < bestScore) { bestScore = score; best = v; }
    }
  }
  return best ?? sorted.map((p) => p + 60);
}

function nearest(pc, ref, lo = BASS_LO, hi = BASS_HI) {
  let best = null;
  for (let n = lo; n <= hi; n++) {
    if (n % 12 === pc && (best === null || Math.abs(n - ref) < Math.abs(best - ref))) best = n;
  }
  return best;
}

// ---------- comping rhythms: hits as { p (quarters into the bar), d (length), v (velocity) } ----------
const COMP = {
  swing(r, b, barQ, changes) {
    if (changes.length > 1) return changes.map((c) => ({ p: c, d: 0.7, v: 0.72 }));
    return pick(r, [
      [{ p: 0, d: 0.6, v: 0.75 }, { p: 1.5, d: 0.5, v: 0.65 }],
      [{ p: 1.5, d: 0.6, v: 0.7 }, { p: 3, d: 0.5, v: 0.62 }],
      [{ p: 0, d: 1.2, v: 0.7 }, { p: 2, d: 1, v: 0.6 }],
      [{ p: 1, d: 0.5, v: 0.66 }, { p: 3, d: 0.5, v: 0.66 }],
      [{ p: 0, d: 0.5, v: 0.72 }, { p: 2.5, d: 0.6, v: 0.65 }],
      [{ p: 1.5, d: 0.5, v: 0.7 }, { p: 3.5, d: 0.8, v: 0.66 }],
    ]);
  },
  waltz(r, b, barQ, changes) {
    if (changes.length > 1) return changes.map((c) => ({ p: c, d: 0.7, v: 0.7 }));
    return pick(r, [
      [{ p: 0, d: 0.6, v: 0.72 }, { p: 1.5, d: 0.5, v: 0.62 }],
      [{ p: 1, d: 0.5, v: 0.66 }, { p: 2, d: 0.5, v: 0.62 }],
      [{ p: 0, d: 1.6, v: 0.7 }],
      [{ p: 1.5, d: 0.5, v: 0.66 }, { p: 2.5, d: 0.8, v: 0.64 }],
    ]);
  },
  bossa(r, b, barQ, changes) {
    if (changes.length > 1) return changes.flatMap((c) => [{ p: c, d: 0.45, v: 0.7 }, { p: c + 1.5, d: 0.45, v: 0.6 }]);
    if (b % 2 === 0) return [{ p: 0, d: 0.45, v: 0.72 }, { p: 1.5, d: 0.45, v: 0.62 }, { p: 3, d: 0.45, v: 0.66 }];
    return r() < 0.25
      ? [{ p: 0, d: 0.45, v: 0.66 }, { p: 1, d: 0.45, v: 0.62 }, { p: 2.5, d: 0.45, v: 0.64 }]
      : [{ p: 1, d: 0.45, v: 0.66 }, { p: 2.5, d: 0.45, v: 0.64 }];
  },
  ballad(r, b, barQ, changes) {
    if (changes.length > 1) return changes.map((c, k) => ({ p: c, d: (changes[k + 1] ?? barQ) - c, v: 0.6 }));
    return r() < 0.6 ? [{ p: 0, d: barQ, v: 0.62 }] : [{ p: 0, d: 2, v: 0.62 }, { p: 2, d: barQ - 2, v: 0.5 }];
  },
  pop(r, b, barQ) {
    const quarters = Array.from({ length: Math.round(barQ) }, (_, k) => ({ p: k, d: 0.9, v: k % 2 ? 0.58 : 0.68 }));
    if (barQ !== 4) return quarters;
    return pick(r, [
      quarters,
      [{ p: 0, d: 1.4, v: 0.7 }, { p: 1.5, d: 0.9, v: 0.62 }, { p: 2.5, d: 1.4, v: 0.64 }],
      [{ p: 0, d: 0.9, v: 0.7 }, { p: 1, d: 0.45, v: 0.58 }, { p: 1.5, d: 0.9, v: 0.6 }, { p: 2.5, d: 0.45, v: 0.58 }, { p: 3, d: 0.9, v: 0.62 }],
    ]);
  },
  funk(r, b, barQ, changes) {
    if (changes.length > 1) return changes.flatMap((c) => [{ p: c, d: 0.2, v: 0.75 }, { p: c + 0.75, d: 0.2, v: 0.6 }, { p: c + 1.5, d: 0.2, v: 0.62 }]);
    return pick(r, [
      [{ p: 0, d: 0.2, v: 0.75 }, { p: 0.75, d: 0.2, v: 0.6 }, { p: 1.5, d: 0.2, v: 0.62 }, { p: 2.5, d: 0.2, v: 0.6 }, { p: 3.25, d: 0.2, v: 0.58 }],
      [{ p: 0, d: 0.2, v: 0.75 }, { p: 0.5, d: 0.2, v: 0.55 }, { p: 1.75, d: 0.2, v: 0.62 }, { p: 2, d: 0.2, v: 0.6 }, { p: 3, d: 0.2, v: 0.58 }, { p: 3.75, d: 0.4, v: 0.62 }],
      [{ p: 0.5, d: 0.2, v: 0.7 }, { p: 1.25, d: 0.2, v: 0.58 }, { p: 2, d: 0.2, v: 0.62 }, { p: 2.75, d: 0.2, v: 0.58 }, { p: 3.5, d: 0.2, v: 0.6 }],
    ]);
  },
};

// ---------- bass patterns (non-walking): { p, d, t: 'R'|'5'|'3'|'8'|'7'|'A' } ----------
const BASS = {
  bossa: () => [{ p: 0, d: 1.45, t: 'R' }, { p: 1.5, d: 0.45, t: '5' }, { p: 2, d: 1.9, t: '5' }],
  ballad: (r) => (r() < 0.4 ? [{ p: 0, d: 3.9, t: 'R' }] : [{ p: 0, d: 1.9, t: 'R' }, { p: 2, d: 1.9, t: r() < 0.6 ? '5' : '3' }]),
  pop: (r) => {
    const hits = Array.from({ length: 8 }, (_, k) => ({ p: k * 0.5, d: 0.42, t: 'R' }));
    if (r() < 0.35) { hits[3].t = '8'; hits[7].t = '8'; }
    if (r() < 0.3) hits[7].t = 'A';
    return hits;
  },
  funk: (r) => pick(r, [
    [{ p: 0, d: 0.45, t: 'R' }, { p: 0.75, d: 0.2, t: 'R' }, { p: 1.5, d: 0.2, t: '8' }, { p: 2, d: 0.2, t: 'R' }, { p: 2.75, d: 0.2, t: '7' }, { p: 3, d: 0.2, t: '5' }, { p: 3.5, d: 0.2, t: '8' }],
    [{ p: 0, d: 0.7, t: 'R' }, { p: 1, d: 0.2, t: '5' }, { p: 1.5, d: 0.2, t: '8' }, { p: 2.25, d: 0.2, t: 'R' }, { p: 2.5, d: 0.2, t: 'R' }, { p: 3.25, d: 0.2, t: '7' }, { p: 3.5, d: 0.4, t: 'A' }],
  ]),
};

// ---------- drums: { p, drum, v } ----------
function ghosts(r, positions, prob, lo, hi) {
  return positions.filter(() => r() < prob).map((p) => ({ p, drum: 'snare', v: lo + r() * (hi - lo) }));
}
const DRUMS = {
  swing(r, ctx) {
    const h = [0, 1, 1.5, 2, 3, 3.5].map((p) => ({ p, drum: 'ride', v: p % 1 ? 0.5 : p % 2 ? 0.82 : 0.72 }));
    h.push({ p: 1, drum: 'hhp', v: 0.55 }, { p: 3, drum: 'hhp', v: 0.55 });
    for (let p = 0; p < 4; p++) h.push({ p, drum: 'kick', v: 0.16 });
    h.push(...ghosts(r, [0.5, 1.5, 2.5], 0.14, 0.22, 0.42));
    if (ctx.phraseEnd) h.push({ p: 3.5, drum: 'snare', v: 0.62 }, { p: 3.5, drum: 'kick', v: 0.5 });
    return h;
  },
  waltz(r, ctx) {
    const h = [{ p: 0, drum: 'ride', v: 0.75 }, { p: 1, drum: 'ride', v: 0.7 }, { p: 1.5, drum: 'ride', v: 0.48 }, { p: 2, drum: 'ride', v: 0.72 }];
    h.push({ p: 1, drum: 'hhp', v: 0.45 }, { p: 2, drum: 'hhp', v: 0.45 }, { p: 0, drum: 'kick', v: 0.25 });
    h.push(...ghosts(r, [0.5, 2.5], 0.12, 0.22, 0.4));
    if (ctx.phraseEnd) h.push({ p: 2.5, drum: 'snare', v: 0.6 });
    return h;
  },
  bossa(r, ctx) {
    const h = [];
    for (let p = 0; p < 4; p += 0.5) h.push({ p, drum: 'shaker', v: p % 1 ? 0.5 : 0.3 });
    const clave = ctx.bar % 2 === 0 ? [0, 1.5, 3] : [1, 2.5];
    for (const p of clave) h.push({ p, drum: 'rim', v: 0.68 });
    h.push({ p: 0, drum: 'kick', v: 0.72 }, { p: 1.5, drum: 'kick', v: 0.42 }, { p: 2, drum: 'kick', v: 0.72 }, { p: 3.5, drum: 'kick', v: 0.42 });
    h.push({ p: 1, drum: 'hhp', v: 0.28 }, { p: 3, drum: 'hhp', v: 0.28 });
    return h;
  },
  ballad(r, ctx) {
    const h = [];
    for (let p = 0; p < 4; p += 0.5) h.push({ p, drum: 'hhc', v: p % 1 ? 0.32 : 0.5 });
    h.push({ p: 1, drum: 'rim', v: 0.8 }, { p: 3, drum: 'rim', v: 0.8 }, { p: 0, drum: 'kick', v: 0.75 });
    if (r() < 0.4) h.push({ p: 2.5, drum: 'kick', v: 0.5 });
    return h;
  },
  pop(r, ctx) {
    const h = [];
    const fill = ctx.phraseEnd;
    const hatEnd = fill ? 2 : 4;
    for (let p = 0; p < hatEnd; p += 0.5) h.push({ p, drum: p === 3.5 && r() < 0.2 ? 'hho' : 'hhc', v: p % 1 ? 0.38 : 0.6 });
    h.push({ p: 0, drum: 'kick', v: 0.9 }, { p: 1, drum: 'snare', v: 0.82 });
    if (!fill) {
      h.push({ p: 2, drum: 'kick', v: 0.85 }, { p: 3, drum: 'snare', v: 0.85 });
      if (r() < 0.45) h.push({ p: 2.5, drum: 'kick', v: 0.6 });
      if (r() < 0.25) h.push({ p: 1.5, drum: 'kick', v: 0.55 });
    } else {
      for (let k = 0; k < 8; k++) h.push({ p: 2 + k * 0.25, drum: 'snare', v: 0.42 + k * 0.06 });
      h.push({ p: 2, drum: 'kick', v: 0.8 });
    }
    return h;
  },
  funk(r, ctx) {
    const h = [];
    const open = r() < 0.5;
    for (let p = 0; p < 4; p += 0.25) {
      if (open && p === 3.75) continue;
      h.push({ p, drum: open && p === 3.5 ? 'hho' : 'hhc', v: p % 0.5 ? 0.28 : p % 1 ? 0.42 : 0.55 });
    }
    h.push({ p: 1, drum: 'snare', v: 0.9 }, { p: 3, drum: 'snare', v: 0.92 });
    h.push(...ghosts(r, [1.75, 2.25, 3.75], 0.45, 0.18, 0.3));
    for (const p of pick(r, [[0, 0.75, 2.5], [0, 1.5, 2.25, 2.75], [0, 0.5, 2.5, 3.25]])) h.push({ p, drum: 'kick', v: p === 0 ? 0.92 : 0.72 });
    return h;
  },
};

/**
 * Generate the band.
 * Returns { comp: [{ q, dur, midis, vel, spell }], bass: [...], drums: [{ q, drum, vel }], chart, barQ, length }
 */
export function generateBacking({ bars, ts, style: styleKey, seed = 1, ending = true }) {
  const style = STYLES[styleKey] || STYLES.swing;
  const [num, den] = ts.split('/').map(Number);
  const slotQ = 4 / den, barQ = num * slotQ;
  const chart = parseChart(bars, num, slotQ);
  const nBars = bars.length;
  const length = nBars * barQ;
  const comp = [], bass = [], drums = [];
  if (!nBars) return { comp, bass, drums, chart, barQ, length };

  // Chord runs: consecutive segments of the same chord merged.
  const runs = [];
  for (const s of chart.segments) {
    const last = runs[runs.length - 1];
    if (last && s.cont) last.end = s.q + s.dur;
    else runs.push({ q: s.q, end: s.q + s.dur, chord: s.chord });
  }
  const runAt = (q) => {
    for (let k = runs.length - 1; k >= 0; k--) if (runs[k].q <= q + 1e-9) return k;
    return -1;
  };
  const eps = 1e-6;

  // ---- comping ----
  const range = COMP_RANGE[style.voicing];
  const compStyle = COMP[styleKey] ? styleKey : 'swing';
  let prevV = null, anticipated = false;
  for (let b = 0; b < nBars; b++) {
    const r = barRandom(seed, b, 1);
    const start = b * barQ;
    const isEnd = ending && b === nBars - 1;
    const changes = chart.segments.filter((s) => s.bar === b && !s.cont).map((s) => s.q - start);
    let hits = isEnd ? [{ p: 0, d: barQ, v: 0.72 }] : COMP[compStyle](r, b, barQ, changes);
    hits = hits.filter((h) => h.p < barQ - eps);
    for (const c of changes) {
      if (c > 0 && !hits.some((h) => Math.abs(h.p - c) < eps)) hits.push({ p: c, d: 0.6, v: 0.66 });
    }
    hits.sort((x, y) => x.p - y.p);
    if (anticipated) hits = hits.filter((h) => h.p > eps);
    anticipated = false;
    for (const h of hits) {
      const q = start + h.p;
      let k = runAt(q);
      let antic = false;
      // A hit in the bar's last eighth anticipates the next bar's chord (and replaces its downbeat).
      if (!isEnd && h.p >= barQ - 0.5 - eps && b + 1 < nBars) {
        const nk = runAt(start + barQ);
        if (nk > k && Math.abs(runs[nk].q - (start + barQ)) < eps && runs[nk].chord) { k = nk; antic = true; anticipated = true; }
      }
      const run = runs[k];
      if (!run?.chord) continue;
      const runEnd = k + 1 < runs.length ? runs[k + 1].q : length;
      let dur = antic ? Math.max(h.d, run.q - q + 0.5) : h.d;
      dur = Math.min(dur, runEnd - q);
      const v = voiceLead(compPcs(run.chord, style.voicing, r), prevV, range);
      prevV = v;
      comp.push({ q, dur: Math.max(0.2, dur - 0.02), midis: v, vel: human(r, h.v), spell: run.chord.flats ? 'b' : '#', chord: run.chord });
    }
  }

  // ---- bass ----
  const walking = styleKey === 'swing' || styleKey === 'waltz';
  let cur = BASS_HOME;
  const bassRoot = (chord, ref) => nearest(chord.bass, ref) ?? nearest(chord.bass, BASS_HOME);
  const toneOf = (chord, t, rootPitch, nextChord) => {
    const tt = chord.tones;
    switch (t) {
      case '5': { const f = tt.fifth ?? 7; const up = rootPitch + f, down = rootPitch + f - 12; return up <= BASS_HI && Math.abs(up - cur) <= Math.abs(down - cur) ? up : down >= BASS_LO ? down : up; }
      case '3': return rootPitch + (tt.third ?? 7);
      case '8': return rootPitch + 12 <= BASS_HI + 5 ? rootPitch + 12 : rootPitch;
      case '7': return rootPitch + (tt.seventh ?? 12) - (tt.seventh === 11 ? 12 : 0);
      case 'A': {
        if (!nextChord) return rootPitch;
        const target = bassRoot(nextChord, rootPitch);
        return target + (rootPitch < target ? -1 : 1);
      }
      default: return rootPitch;
    }
  };

  if (walking) {
    for (let b = 0; b < nBars; b++) {
      const r = barRandom(seed, b, 2);
      const start = b * barQ;
      for (let beat = 0; beat < num; beat++) {
        const q = start + beat * slotQ;
        const k = runAt(q), run = runs[k];
        if (!run?.chord) continue;
        const isEnd = ending && b === nBars - 1;
        if (isEnd && beat > 0) break;
        const idx = Math.round((q - run.q) / slotQ);
        const len = Math.round((run.end - run.q) / slotQ);
        const next = runs[k + 1]?.chord ? runs[k + 1] : null;
        let note;
        if (idx === 0) note = bassRoot(run.chord, cur);
        else if (idx === len - 1 && next) {
          const target = bassRoot(next.chord, cur);
          const x = r();
          if (x < 0.55) note = target + (cur < target ? -1 : 1);
          else if (x < 0.8) note = target + (cur < target ? -2 : 2);
          else note = nearest((next.chord.root + 7) % 12, cur);
          if (note === cur || note < BASS_LO || note > BASS_HI) note = target + (cur < target ? 1 : -1);
        } else {
          const target = next ? bassRoot(next.chord, cur) : bassRoot(run.chord, cur);
          const remaining = Math.max(1, len - idx);
          const goal = cur + (target - cur) / remaining;
          const cands = [];
          for (const pc of chordPcs(run.chord)) for (let n = BASS_LO; n <= BASS_HI; n++) if (n % 12 === pc) cands.push(n);
          let best = cur, bestS = Infinity;
          for (const c of cands) {
            const s = Math.abs(c - goal) + (c === cur ? 4 : 0) + (Math.abs(c - cur) > 7 ? 3 : 0) + r() * 2;
            if (s < bestS) { bestS = s; best = c; }
          }
          note = best;
        }
        cur = note;
        const dur = isEnd ? barQ : slotQ * 0.92;
        bass.push({ q, dur, midis: [note], vel: human(r, beat === 0 ? 0.85 : 0.75), spell: run.chord.flats ? 'b' : '#', chord: run.chord });
      }
    }
  } else {
    const pattern = BASS[styleKey] || BASS.pop;
    for (let b = 0; b < nBars; b++) {
      const r = barRandom(seed, b, 2);
      const start = b * barQ;
      const isEnd = ending && b === nBars - 1;
      const changes = chart.segments.filter((s) => s.bar === b && !s.cont).map((s) => s.q - start);
      let hits = isEnd ? [{ p: 0, d: barQ, t: 'R' }] : pattern(r).filter((h) => h.p < barQ - eps);
      for (const c of changes) if (c > 0 && !hits.some((h) => Math.abs(h.p - c) < eps)) hits.push({ p: c, d: 0.9, t: 'R' });
      hits.sort((x, y) => x.p - y.p);
      let rootPitch = null, rootRun = -1;
      for (const h of hits) {
        const q = start + h.p;
        const k = runAt(q), run = runs[k];
        if (!run?.chord) continue;
        const atChange = changes.some((c) => Math.abs(c - h.p) < eps);
        if (k !== rootRun) { rootPitch = bassRoot(run.chord, cur); rootRun = k; }
        const t = atChange ? 'R' : h.t;
        let note = toneOf(run.chord, t, rootPitch, runs[k + 1]?.chord);
        while (note > BASS_HI + 5) note -= 12;
        while (note < BASS_LO - 3) note += 12;
        const limit = (k + 1 < runs.length ? runs[k + 1].q : length) - q;
        cur = t === 'R' ? note : cur;
        bass.push({ q, dur: Math.max(0.15, Math.min(h.d, limit - 0.02)), midis: [note], vel: human(r, h.p === 0 ? 0.85 : 0.72), spell: run.chord.flats ? 'b' : '#', chord: run.chord });
      }
    }
  }

  // A bass plays one note at a time: cut each note where the next begins.
  bass.sort((x, y) => x.q - y.q);
  for (let k = 0; k + 1 < bass.length; k++) bass[k].dur = Math.max(0.1, Math.min(bass[k].dur, bass[k + 1].q - bass[k].q - 0.02));

  // ---- drums ----
  const drumStyle = DRUMS[styleKey] ? styleKey : 'swing';
  const seen = new Set();
  for (let b = 0; b < nBars; b++) {
    const r = barRandom(seed, b, 3);
    const start = b * barQ;
    const isEnd = ending && b === nBars - 1;
    const phraseEnd = !isEnd && b + 1 < nBars && (b % 8 === 7 || (ending && b === nBars - 2));
    let hits = isEnd
      ? [{ p: 0, drum: 'crash', v: 0.8 }, { p: 0, drum: 'kick', v: 0.85 }]
      : DRUMS[drumStyle](r, { bar: b, phraseEnd, barQ });
    if (!isEnd && (b === 0 || b % 8 === 0) && styleKey !== 'ballad') {
      hits.push({ p: 0, drum: 'crash', v: b === 0 ? 0.55 : 0.68 });
      if (!hits.some((h) => h.drum === 'kick' && h.p === 0)) hits.push({ p: 0, drum: 'kick', v: 0.7 });
    }
    for (const h of hits) {
      if (h.p >= barQ - eps) continue;
      const q = start + h.p;
      const key = (DRUM_VOICE[h.drum] || h.drum) + '@' + q.toFixed(4);
      if (seen.has(key)) continue;
      seen.add(key);
      drums.push({ q, drum: h.drum, vel: human(r, h.v) });
    }
  }
  drums.sort((x, y) => x.q - y.q);

  return { comp, bass, drums, chart, barQ, length };
}
