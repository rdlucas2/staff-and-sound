// Engraves one or more parts as stacked staves with VexFlow's low-level API.
// Bars line up vertically across parts: each bar index is formatted jointly for every staff,
// with invisible ghost notes padding any part that is shorter in that bar.
import { durQ, toMeasures } from './notation.js';

const NOTE_W = { w: 46, h: 40, q: 34, '8': 30, '16': 27, '32': 25 };
const CLEF_W = 44, TS_W = 30, STAFF_H = 92, SYSTEM_GAP = 34, TOP = 6, LEFT = 4;
const PAD_DURS = [['w', 4], ['h', 2], ['q', 1], ['8', 0.5], ['16', 0.25], ['32', 0.125]];

/**
 * parts: [{ id, name, clef, color, notes }]
 * opts: { ts, active (part index), onNoteClick(partIndex, noteIndex), onStaffClick(partIndex) }
 * Returns { noteEls: [[g per note] per part], bars }
 */
export function renderScore(el, parts, { ts, active = 0, onNoteClick, onStaffClick }) {
  const VF = window.VexFlow;
  el.innerHTML = '';
  const W = Math.max(330, el.clientWidth || 600);
  const multi = parts.length > 1;
  const LABEL_W = multi ? 74 : 0;
  const avail = W - LEFT * 2 - LABEL_W;
  const measures = parts.map((p) => toMeasures(p.notes, ts));
  const M = Math.max(1, ...measures.map((m) => m.length));

  const naturalFor = (pi, mi) => {
    const idxs = measures[pi][mi];
    if (!idxs) return 0;
    const notes = parts[pi].notes;
    return 24 + idxs.reduce((s, i) => {
      const n = notes[i];
      return s + NOTE_W[n.dur] + (n.dots ? 8 : 0) + (n.keys.some((k) => k.acc) ? 12 : 0);
    }, 0);
  };
  const natural = (mi) => Math.max(60, ...parts.map((_, pi) => naturalFor(pi, mi)));
  const prefix = (lineNo, posInLine) => (posInLine === 0 ? CLEF_W : 0) + (lineNo === 0 && posInLine === 0 ? TS_W : 0);

  // Greedy line breaking over bar indexes.
  const lines = [];
  let line = [], lineW = 0;
  for (let mi = 0; mi < M; mi++) {
    const w = natural(mi) + prefix(lines.length, line.length);
    if (line.length && lineW + w > avail) { lines.push(line); line = []; lineW = 0; }
    lineW += natural(mi) + prefix(lines.length, line.length);
    line.push(mi);
  }
  if (line.length) lines.push(line);

  const systemH = parts.length * STAFF_H + SYSTEM_GAP;
  const renderer = new VF.Renderer(el, VF.Renderer.Backends.SVG);
  renderer.resize(W, TOP + lines.length * systemH);
  const ctx = renderer.getContext();
  const [num, den] = ts.split('/').map(Number);
  const beamGroups = VF.Beam.getDefaultBeamGroups(ts);
  const noteEls = parts.map((p) => new Array(p.notes.length));
  const drawn = [];
  const x0 = LEFT + LABEL_W;

  lines.forEach((bars, li) => {
    const sysY = TOP + li * systemH;
    const staffY = (pi) => sysY + pi * STAFF_H;

    // Active-part band and clickable staff areas.
    parts.forEach((p, pi) => {
      const top = staffY(pi) + 28, h = 64;
      if (multi && pi === active) {
        ctx.save();
        ctx.setFillStyle('rgba(42, 111, 176, 0.07)');
        ctx.fillRect(LEFT, top, W - LEFT * 2, h);
        ctx.restore();
      }
      if (multi) {
        ctx.save();
        ctx.setFont('Arial', 11, pi === active ? 'bold' : 'normal');
        ctx.setFillStyle(pi === active ? '#2a6fb0' : '#55534c');
        const label = p.name.length > 11 ? p.name.slice(0, 10) + '…' : p.name;
        ctx.fillText(label, LEFT + 2, staffY(pi) + 64);
        ctx.restore();
      }
    });

    const stretchBase = (() => {
      const nats = bars.map(natural);
      const pres = bars.map((_, i) => prefix(li, i));
      const preSum = pres.reduce((a, b) => a + b, 0), natSum = nats.reduce((a, b) => a + b, 0);
      const isLast = li === lines.length - 1;
      return isLast && natSum + preSum < avail * 0.7 ? 1 : (avail - preSum) / natSum;
    })();

    let x = x0;
    bars.forEach((mi, bi) => {
      const w = natural(mi) * stretchBase + prefix(li, bi);
      const isFinal = li === lines.length - 1 && bi === bars.length - 1;
      const staves = parts.map((p, pi) => {
        const st = new VF.Stave(x, staffY(pi), w);
        if (bi === 0) st.addClef(p.clef);
        if (li === 0 && bi === 0) st.addTimeSignature(ts);
        if (isFinal) st.setEndBarType(VF.Barline.type.END);
        return st;
      });
      VF.Stave.formatBegModifiers(staves);
      staves.forEach((st) => st.setContext(ctx).draw());

      if (bi === 0) {
        if (multi) {
          new VF.StaveConnector(staves[0], staves[staves.length - 1]).setType('bracket').setContext(ctx).draw();
        }
        new VF.StaveConnector(staves[0], staves[staves.length - 1]).setType('singleLeft').setContext(ctx).draw();
      }

      // Build one voice per part, then pad shorter voices so they format together.
      const built = parts.map((p, pi) => {
        const idxs = measures[pi][mi] || [];
        const sns = idxs.map((i) => {
          const n = p.notes[i];
          const keys = n.rest
            ? [p.clef === 'bass' ? 'd/3' : 'b/4']
            : n.keys.map((k) => k.letter + (k.acc === 'n' ? '' : k.acc) + '/' + k.oct);
          const sn = new VF.StaveNote({ keys, duration: n.dur + (n.rest ? 'r' : ''), dots: n.dots, clef: p.clef, autoStem: true });
          if (n.dots) VF.Dot.buildAndAttach([sn], { all: true });
          sn.__part = pi; sn.__idx = i;
          return sn;
        });
        const q = idxs.reduce((s, i) => s + durQ(p.notes[i]), 0);
        return { sns, q };
      });
      const maxQ = Math.max(...built.map((b) => b.q));
      const voices = [];
      built.forEach((b, pi) => {
        let missing = maxQ - b.q;
        const tickables = [...b.sns];
        for (const [d, v] of PAD_DURS) {
          while (missing >= v - 1e-9) { tickables.push(new VF.GhostNote({ duration: d })); missing -= v; }
        }
        if (!tickables.length) return;
        const voice = new VF.Voice({ numBeats: num, beatValue: den }).setMode(VF.Voice.Mode.SOFT).addTickables(tickables);
        if (b.sns.length) VF.Accidental.applyAccidentals([voice], 'C');
        voices.push({ voice, stave: staves[pi], sns: b.sns });
      });
      if (voices.length) {
        const fmt = new VF.Formatter();
        voices.forEach((v) => fmt.joinVoices([v.voice]));
        const width = Math.max(20, staves[0].getNoteEndX() - staves[0].getNoteStartX() - 14);
        fmt.format(voices.map((v) => v.voice), width);
        voices.forEach((v) => {
          const beams = v.sns.length ? VF.Beam.generateBeams(v.sns, { groups: beamGroups }) : [];
          v.voice.draw(ctx, v.stave);
          beams.forEach((bm) => bm.setContext(ctx).draw());
          drawn.push(...v.sns);
        });
      }
      x += w;
    });
  });

  for (const sn of drawn) {
    const g = sn.getSVGElement();
    if (!g) continue;
    noteEls[sn.__part][sn.__idx] = g;
    g.style.setProperty('--pc', parts[sn.__part].color);
    g.addEventListener('click', (e) => { e.stopPropagation(); onNoteClick?.(sn.__part, sn.__idx); });
  }

  // Clicking empty space on a staff selects that part.
  el.querySelector('svg')?.addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - r.top;
    const inSystem = (y - TOP) % systemH;
    const pi = Math.floor(inSystem / STAFF_H);
    if (pi >= 0 && pi < parts.length) onStaffClick?.(pi);
  });

  return { noteEls, bars: M, beats: Math.max(0, ...parts.map((p) => p.notes.reduce((s, n) => s + durQ(n), 0))) };
}
