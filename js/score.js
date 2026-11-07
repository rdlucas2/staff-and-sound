// Engraves one or more parts as stacked staves with VexFlow's low-level API.
// Bars line up vertically across parts: each bar index is formatted jointly for every staff,
// with invisible ghost notes padding any part that is shorter in that bar.
import { durQ, toMeasures, isTiedFrom } from './notation.js';
import { prettyChord } from './chords.js';

const NOTE_W = { w: 46, h: 40, q: 34, '8': 30, '16': 27, '32': 25 };
const CLEF_W = 44, TS_W = 30, STAFF_H = 92, SYSTEM_GAP = 34, TOP = 6, LEFT = 4;
const LANE = 14;          // extra room above each system for chord symbols
const CHORD_W = 58;       // minimum width per chord symbol in a bar
const SVGNS = 'http://www.w3.org/2000/svg';
const PAD_DURS = [['w', 4], ['h', 2], ['q', 1], ['8', 0.5], ['16', 0.25], ['32', 0.125]];

/**
 * parts: [{ id, name, clef, color, notes }]
 * opts: { ts, active (part index), chart (parseChart result), minBars,
 *         onNoteClick(partIndex, noteIndex), onStaffClick(partIndex), onChordClick(bar, rect) }
 * Returns { noteEls: [[g per note] per part], chordEls: { 'bar:index': <text> }, bars, beats }
 */
export function renderScore(el, parts, { ts, active = 0, chart = null, minBars = 1, onNoteClick, onStaffClick, onChordClick }) {
  const VF = window.VexFlow;
  el.innerHTML = '';
  const W = Math.max(330, el.clientWidth || 600);
  const multi = parts.length > 1;
  const LABEL_W = multi ? 74 : 0;
  const avail = W - LEFT * 2 - LABEL_W;
  const measures = parts.map((p) => toMeasures(p.notes, ts));
  const chartBars = chart?.bars || [];
  const M = Math.max(1, minBars, chartBars.length, ...measures.map((m) => m.length));

  const naturalFor = (pi, mi) => {
    const idxs = measures[pi][mi];
    if (!idxs) return 0;
    const notes = parts[pi].notes;
    return 24 + idxs.reduce((s, i) => {
      const n = notes[i];
      return s + NOTE_W[n.dur] + (n.dots ? 8 : 0) + (n.keys.some((k) => k.acc) ? 12 : 0);
    }, 0);
  };
  const chordCount = (mi) => chartBars[mi]?.chords.length || 0;
  const natural = (mi) => Math.max(measures.some((m) => m[mi]) ? 60 : 96, chordCount(mi) * CHORD_W + 16, ...parts.map((_, pi) => naturalFor(pi, mi)));
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

  const systemH = LANE + parts.length * STAFF_H + SYSTEM_GAP;
  const renderer = new VF.Renderer(el, VF.Renderer.Backends.SVG);
  renderer.resize(W, TOP + lines.length * systemH);
  const ctx = renderer.getContext();
  const [num, den] = ts.split('/').map(Number);
  const beamGroups = VF.Beam.getDefaultBeamGroups(ts);
  const noteEls = parts.map((p) => new Array(p.notes.length));
  const drawn = [];
  const placed = parts.map(() => []); // [part][noteIndex] -> { sn, line }
  const x0 = LEFT + LABEL_W;
  const slots = []; // chord-lane click targets: { bar, x, y, w, h }
  const chordPos = []; // { bar, k, x, y }

  lines.forEach((bars, li) => {
    const sysY = TOP + li * systemH;
    const staffY = (pi) => sysY + LANE + pi * STAFF_H;

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

      // Chord lane above the top staff.
      const nsx = staves[0].getNoteStartX(), nex = staves[0].getNoteEndX();
      slots.push({ bar: mi, x: x + 1, y: sysY + 4, w: w - 2, h: 30 });
      (chartBars[mi]?.chords || []).forEach((c, k) => {
        const frac = c.slot / num;
        chordPos.push({ bar: mi, k, c, x: nsx + 4 + frac * (nex - nsx - 8), y: sysY + 30 });
      });

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
          placed[pi][i] = { sn, line: li };
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

  // Ties: a full curve within a line, or two half curves across a line break.
  parts.forEach((p, pi) => {
    for (let i = 1; i < p.notes.length; i++) {
      if (!isTiedFrom(p.notes, i)) continue;
      const a = placed[pi][i - 1], b = placed[pi][i];
      if (!a || !b) continue;
      const idx = p.notes[i].keys.map((_, j) => j);
      const ties = a.line === b.line
        ? [{ firstNote: a.sn, lastNote: b.sn, firstIndexes: idx, lastIndexes: idx }]
        : [{ firstNote: a.sn, firstIndexes: idx, lastIndexes: idx }, { lastNote: b.sn, firstIndexes: idx, lastIndexes: idx }];
      for (const t of ties) new VF.StaveTie(t).setContext(ctx).draw();
    }
  });

  for (const sn of drawn) {
    const g = sn.getSVGElement();
    if (!g) continue;
    noteEls[sn.__part][sn.__idx] = g;
    g.style.setProperty('--pc', parts[sn.__part].color);
    g.addEventListener('click', (e) => { e.stopPropagation(); onNoteClick?.(sn.__part, sn.__idx); });
  }

  const svg = el.querySelector('svg');

  // Chord slots go underneath everything (first in the SVG) so notes stay clickable.
  const slotLayer = document.createElementNS(SVGNS, 'g');
  slotLayer.setAttribute('class', 'chord-slots');
  for (const sl of slots) {
    const r = document.createElementNS(SVGNS, 'rect');
    r.setAttribute('x', sl.x); r.setAttribute('y', sl.y); r.setAttribute('width', sl.w); r.setAttribute('height', sl.h);
    r.setAttribute('rx', 4);
    r.setAttribute('class', 'chord-slot' + (chordCount(sl.bar) ? '' : ' empty'));
    const title = document.createElementNS(SVGNS, 'title');
    title.textContent = `Bar ${sl.bar + 1}: click to type chords`;
    r.appendChild(title);
    r.addEventListener('click', (e) => { e.stopPropagation(); onChordClick?.(sl.bar, sl); });
    slotLayer.appendChild(r);
  }
  svg?.insertBefore(slotLayer, svg.firstChild);

  // Chord symbols: root large, quality raised and smaller.
  const chordEls = {};
  const textLayer = document.createElementNS(SVGNS, 'g');
  textLayer.setAttribute('class', 'chord-syms');
  for (const { bar, k, c, x, y } of chordPos) {
    const pc = prettyChord(c.sym);
    const t = document.createElementNS(SVGNS, 'text');
    t.setAttribute('x', x); t.setAttribute('y', y);
    t.setAttribute('class', 'chord-sym' + (c.bad ? ' bad' : '') + (c.repeat ? ' repeat' : ''));
    const root = document.createElementNS(SVGNS, 'tspan');
    root.textContent = pc.root;
    t.appendChild(root);
    if (pc.quality) {
      const q = document.createElementNS(SVGNS, 'tspan');
      q.setAttribute('class', 'q'); q.setAttribute('dy', '-5');
      q.textContent = pc.quality;
      t.appendChild(q);
    }
    if (pc.bass) {
      const b = document.createElementNS(SVGNS, 'tspan');
      b.setAttribute('class', 'b'); b.setAttribute('dy', pc.quality ? '5' : '0');
      b.textContent = pc.bass;
      t.appendChild(b);
    }
    textLayer.appendChild(t);
    chordEls[`${bar}:${k}`] = t;
  }
  svg?.appendChild(textLayer);

  // Clicking empty space on a staff selects that part.
  svg?.addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - r.top;
    const inSystem = (y - TOP - LANE) % systemH;
    const pi = Math.floor(inSystem / STAFF_H);
    if (pi >= 0 && pi < parts.length) onStaffClick?.(pi);
  });

  return { noteEls, chordEls, slots, bars: M, beats: Math.max(0, ...parts.map((p) => p.notes.reduce((s, n) => s + durQ(n), 0))) };
}
