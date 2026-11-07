// Engraves the note model with VexFlow's low-level API so each note's SVG group
// can be selected and highlighted during playback.
import { durQ, toMeasures } from './notation.js';

const NOTE_W = { w: 46, h: 40, q: 34, '8': 30, '16': 27, '32': 25 };
const CLEF_W = 44, TS_W = 30, LINE_H = 120, TOP = 10, LEFT = 4;

/**
 * Render notes into `el`. Returns an array mapping note index -> SVG <g> element.
 * opts: { clef, ts, onNoteClick(index) }
 */
export function renderScore(el, notes, { clef, ts, onNoteClick }) {
  const VF = window.VexFlow;
  el.innerHTML = '';
  const W = Math.max(330, el.clientWidth || 600);
  const avail = W - LEFT * 2;
  const measures = toMeasures(notes, ts);
  const natural = (idxs) => 24 + idxs.reduce((s, i) => {
    const n = notes[i];
    return s + NOTE_W[n.dur] + (n.dots ? 8 : 0) + (n.keys.some((k) => k.acc) ? 12 : 0);
  }, 0);
  const prefix = (lineNo, posInLine) => (posInLine === 0 ? CLEF_W : 0) + (lineNo === 0 && posInLine === 0 ? TS_W : 0);

  // Greedy line breaking.
  const lines = [];
  let line = [], lineW = 0;
  for (const m of measures) {
    const w = natural(m) + prefix(lines.length, line.length);
    if (line.length && lineW + w > avail) { lines.push(line); line = []; lineW = 0; }
    lineW += natural(m) + prefix(lines.length, line.length);
    line.push(m);
  }
  if (line.length || !lines.length) lines.push(line);

  const renderer = new VF.Renderer(el, VF.Renderer.Backends.SVG);
  renderer.resize(W, TOP + lines.length * LINE_H + 10);
  const ctx = renderer.getContext();
  const [num, den] = ts.split('/').map(Number);
  const beamGroups = VF.Beam.getDefaultBeamGroups(ts);
  const noteEls = new Array(notes.length);
  const drawn = [];

  lines.forEach((ms, li) => {
    const y = TOP + li * LINE_H;
    if (!ms.length) {
      new VF.Stave(LEFT, y, Math.min(avail, 360)).addClef(clef).addTimeSignature(ts).setContext(ctx).draw();
      return;
    }
    const nats = ms.map(natural);
    const pres = ms.map((_, i) => prefix(li, i));
    const preSum = pres.reduce((a, b) => a + b, 0);
    const natSum = nats.reduce((a, b) => a + b, 0);
    const isLast = li === lines.length - 1;
    const stretch = isLast && natSum + preSum < avail * 0.7 ? 1 : (avail - preSum) / natSum;
    let x = LEFT;
    ms.forEach((idxs, mi) => {
      const w = Math.max(60, nats[mi] * stretch + pres[mi]);
      const stave = new VF.Stave(x, y, w);
      if (mi === 0) stave.addClef(clef);
      if (li === 0 && mi === 0) stave.addTimeSignature(ts);
      if (isLast && mi === ms.length - 1) stave.setEndBarType(VF.Barline.type.END);
      stave.setContext(ctx).draw();

      const sns = idxs.map((i) => {
        const n = notes[i];
        const keys = n.rest
          ? [clef === 'bass' ? 'd/3' : 'b/4']
          : n.keys.map((k) => k.letter + (k.acc === 'n' ? '' : k.acc) + '/' + k.oct);
        const sn = new VF.StaveNote({ keys, duration: n.dur + (n.rest ? 'r' : ''), dots: n.dots, clef, autoStem: true });
        if (n.dots) VF.Dot.buildAndAttach([sn], { all: true });
        sn.__idx = i;
        return sn;
      });
      const voice = new VF.Voice({ numBeats: num, beatValue: den }).setMode(VF.Voice.Mode.SOFT).addTickables(sns);
      VF.Accidental.applyAccidentals([voice], 'C');
      const beams = VF.Beam.generateBeams(sns, { groups: beamGroups });
      new VF.Formatter().joinVoices([voice]).format([voice], Math.max(20, stave.getNoteEndX() - stave.getNoteStartX() - 14));
      voice.draw(ctx, stave);
      beams.forEach((b) => b.setContext(ctx).draw());
      drawn.push(...sns);
      x += w;
    });
  });

  for (const sn of drawn) {
    const g = sn.getSVGElement();
    if (!g) continue;
    noteEls[sn.__idx] = g;
    g.addEventListener('click', (e) => { e.stopPropagation(); onNoteClick?.(sn.__idx); });
  }
  return { noteEls, bars: measures.length, beats: notes.reduce((s, n) => s + durQ(n), 0) };
}
