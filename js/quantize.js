// Quantizing a recorded performance into notation-ready timings.
// Works in units of 1/12 of a quarter note, so both straight (1/16 = 3 units) and triplet
// (1/8 triplet = 4, 1/16 triplet = 2) grids land on whole units. Pure functions; runs in Node.
import { capQ } from './notation.js';

export const UNITS_PER_Q = 12;
export const GRIDS = {
  '4': { label: '1/4', units: 12 },
  '8': { label: '1/8', units: 6 },
  '16': { label: '1/16', units: 3 },
  '8t': { label: '1/8 triplet', units: 4 },
  '16t': { label: '1/16 triplet', units: 2 },
};
export const SWINGS = {
  straight: { label: 'Straight', ratio: 0.5 },
  light: { label: 'Light swing', ratio: 0.58 },
  medium: { label: 'Swing', ratio: 0.63 },
  hard: { label: 'Hard swing (triplet)', ratio: 2 / 3 },
};
export const SHORTEST = {
  grid: { label: 'Grid value', q: 0 },
  '8': { label: '1/8', q: 0.5 },
  q: { label: '1/4', q: 1 },
};
export const defaultQuantize = () => ({
  grid: '16', swing: 'straight', shortest: 'grid', legato: false, chordMs: 40, ignoreMs: 30, keepVel: true,
});

/** Undo swing: a played off-beat at `ratio` of the beat is written as the straight off-beat. */
function unswing(b, ratio) {
  if (ratio === 0.5) return b;
  const beat = Math.floor(b), f = b - beat;
  return beat + (f <= ratio ? (f / ratio) * 0.5 : 0.5 + ((f - ratio) / (1 - ratio)) * 0.5);
}

/**
 * raw: [{ midi, t0, t1, vel }] in seconds from the first recorded downbeat (latency already removed).
 * Returns { notes: [{ start, end, midi, vel? }] in 1/12-quarter units, gridUnits, bars, dropped }.
 */
export function quantize(raw, { bpm, ts, grid = '16', swing = 'straight', shortest = 'grid', legato = false, chordMs = 40, ignoreMs = 30, keepVel = true }) {
  const spq = 60 / bpm;
  const g = GRIDS[grid]?.units ?? 3;
  const ratio = (grid === '8' || grid === '16') ? SWINGS[swing]?.ratio ?? 0.5 : 0.5;
  const minLen = Math.max(g, Math.round((SHORTEST[shortest]?.q || 0) * UNITS_PER_Q));
  let dropped = 0;

  const played = raw
    .filter((n) => { const ok = (n.t1 - n.t0) * 1000 >= ignoreMs; if (!ok) dropped++; return ok; })
    .map((n) => ({ ...n }))
    .sort((a, b) => a.t0 - b.t0);

  // Notes struck within the chord window of the first note of a group start together.
  let groupStart = -Infinity;
  for (const n of played) {
    if (n.t0 - groupStart <= chordMs / 1000) n.t0 = groupStart;
    else groupStart = n.t0;
  }

  const snap = (sec) => Math.round((unswing(sec / spq, ratio) * UNITS_PER_Q) / g) * g;
  let notes = [];
  for (const n of played) {
    let start = snap(n.t0);
    let end = snap(n.t1);
    if (start < 0) {
      if (start < -g) { dropped++; continue; } // played well before the first bar
      start = 0;
    }
    if (end - start < minLen) end = start + minLen;
    const out = { start, end, midi: n.midi };
    if (keepVel && n.vel !== undefined) out.vel = n.vel;
    notes.push(out);
  }

  if (legato) {
    const onsets = [...new Set(notes.map((n) => n.start))].sort((a, b) => a - b);
    notes = notes.map((n) => {
      const next = onsets.find((o) => o > n.start);
      return next !== undefined && next - n.end <= UNITS_PER_Q ? { ...n, end: Math.max(n.end, next) } : n;
    });
  }

  const barUnits = Math.round(capQ(ts) * UNITS_PER_Q);
  const last = notes.reduce((m, n) => Math.max(m, n.end), 0);
  return { notes, gridUnits: g, bars: Math.ceil(last / barUnits), dropped };
}
