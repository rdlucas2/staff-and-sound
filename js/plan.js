// Builds everything that sounds (your parts plus the backing band) as timed tracks,
// shared by playback and MIDI export.
import { toEvents, swingQ } from './notation.js';
import { generateBacking, STYLES } from './band.js';

export const BAND_IDS = { comp: 'band-comp', bass: 'band-bass', drums: 'band-drums' };

export const hasChords = (band) => band.chart.some((b) => b && b.trim() && b.trim() !== '/');

/**
 * parts: score parts; band: { on, style, seed, chart, comp, bass, drums }
 * fromQ: start time in quarter notes (playback from a selected note)
 * ending: finish the band with a final chord (off when looping)
 * Returns { tracks, marks, total (s), totalQ, swing, backing }
 *   tracks: [{ key: 'part'|'comp'|'bass'|'drums', name, part, events: [{ t, dur, midis?, drum?, vel?, i? }], hl?, total }]
 *   marks:  [{ t, key: 'bar:index' | null }] chord-symbol highlights
 */
export function buildPlan({ parts, band, ts, bpm, fromQ = 0, ending = true }) {
  const bandOn = band.on && hasChords(band);
  const swing = bandOn ? STYLES[band.style]?.swing ?? 0.5 : 0.5;
  const spq = 60 / bpm;
  const zero = swingQ(fromQ, swing);
  const sec = (q) => (swingQ(q, swing) - zero) * spq;
  const after = (e) => e.q >= fromQ - 1e-6;

  const tracks = [];
  let totalQ = 0;
  parts.forEach((p, pi) => {
    const { events, totalQ: tq } = toEvents(p.notes, bpm, { swing });
    totalQ = Math.max(totalQ, tq);
    tracks.push({
      key: 'part', name: p.name, part: p, hl: pi, total: Math.max(0, sec(tq)),
      events: events.filter(after).map((e) => ({ ...e, t: sec(e.q), dur: sec(e.qEnd) - sec(e.q) })),
    });
  });

  let backing = null;
  const marks = [];
  if (bandOn) {
    backing = generateBacking({ bars: band.chart, ts, style: band.style, seed: band.seed, ending });
    totalQ = Math.max(totalQ, backing.length);
    const timed = (list) => list.filter(after).map((e) => ({
      ...e, t: sec(e.q), dur: e.dur === undefined ? 0.1 : sec(e.q + e.dur) - sec(e.q),
    }));
    tracks.push(
      { key: 'comp', name: 'Comping', part: { id: BAND_IDS.comp, solo: false, ...band.comp }, events: timed(backing.comp) },
      { key: 'bass', name: 'Bass', part: { id: BAND_IDS.bass, solo: false, ...band.bass }, events: timed(backing.bass) },
      { key: 'drums', name: 'Drums', part: { id: BAND_IDS.drums, solo: false, sound: 'drums', ...band.drums }, events: timed(backing.drums) },
    );
    backing.chart.bars.forEach((bar, b) => bar.chords.forEach((c, k) => {
      if (!c.bad && c.q >= fromQ - 1e-6) marks.push({ t: sec(c.q), key: `${b}:${k}` });
    }));
    if (backing.length >= fromQ) marks.push({ t: sec(backing.length), key: null });
  }

  return { tracks, marks, total: Math.max(0.05, sec(totalQ)), totalQ, swing, backing };
}
