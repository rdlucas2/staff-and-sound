// A playable on-screen piano keyboard: multi-touch, glissando by sliding, velocity from how far
// down the key you press (lower is louder).

const BLACK = new Set([1, 3, 6, 8, 10]);
const NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
export const isBlack = (m) => BLACK.has(((m % 12) + 12) % 12);
export const noteLabel = (m) => NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);

/**
 * el: container element. onNoteOn(midi, velocity 0–1), onNoteOff(midi).
 * Returns { setRange(low, high, hints), setDown(midi, on), releaseAll() }
 *   hints: { midi: 'a' } labels drawn on keys (computer-keyboard letters)
 */
export function createKeyboard(el, { onNoteOn, onNoteOff }) {
  let low = 48, high = 84;
  const keys = new Map();     // midi -> element
  const pointers = new Map(); // pointerId -> midi
  el.classList.add('kb');

  function render(hints = {}) {
    el.innerHTML = '';
    keys.clear();
    const whites = [];
    for (let m = low; m <= high; m++) if (!isBlack(m)) whites.push(m);
    const W = whites.length;
    el.style.setProperty('--whites', W);
    for (const m of whites) {
      const k = document.createElement('div');
      k.className = 'kb-white';
      k.dataset.m = m;
      k.innerHTML = `${hints[m] ? `<span class="kb-hint">${hints[m]}</span>` : ''}${m % 12 === 0 ? `<span class="kb-name">${noteLabel(m)}</span>` : ''}`;
      k.setAttribute('aria-label', noteLabel(m));
      el.appendChild(k);
      keys.set(m, k);
    }
    for (let m = low; m <= high; m++) {
      if (!isBlack(m)) continue;
      const idx = whites.indexOf(m - 1);
      if (idx < 0) continue;
      const k = document.createElement('div');
      k.className = 'kb-black';
      k.dataset.m = m;
      k.style.left = `calc(${((idx + 1) / W) * 100}% - (100% / ${W}) * 0.31)`;
      k.style.width = `calc((100% / ${W}) * 0.62)`;
      if (hints[m]) k.innerHTML = `<span class="kb-hint">${hints[m]}</span>`;
      k.setAttribute('aria-label', noteLabel(m));
      el.appendChild(k);
      keys.set(m, k);
    }
  }

  const keyAt = (x, y) => {
    const t = document.elementFromPoint(x, y)?.closest('[data-m]');
    return t && el.contains(t) ? { m: +t.dataset.m, t } : null;
  };
  const velocityAt = (t, y) => {
    const r = t.getBoundingClientRect();
    return Math.max(0.25, Math.min(1, 0.3 + 0.7 * ((y - r.top) / r.height)));
  };

  el.addEventListener('pointerdown', (e) => {
    const hit = keyAt(e.clientX, e.clientY);
    if (!hit) return;
    e.preventDefault();
    el.setPointerCapture?.(e.pointerId);
    pointers.set(e.pointerId, hit.m);
    onNoteOn(hit.m, velocityAt(hit.t, e.clientY));
  });
  el.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    const hit = keyAt(e.clientX, e.clientY);
    const cur = pointers.get(e.pointerId);
    if (!hit || hit.m === cur) return;
    onNoteOff(cur);
    pointers.set(e.pointerId, hit.m);
    onNoteOn(hit.m, velocityAt(hit.t, e.clientY));
  });
  const end = (e) => {
    if (!pointers.has(e.pointerId)) return;
    onNoteOff(pointers.get(e.pointerId));
    pointers.delete(e.pointerId);
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('lostpointercapture', end);
  el.addEventListener('contextmenu', (e) => e.preventDefault());

  return {
    setRange(lo, hi, hints) { low = lo; high = hi; render(hints); },
    setDown(m, on) { keys.get(m)?.classList.toggle('down', on); },
    releaseAll() { for (const [id, m] of pointers) { onNoteOff(m); pointers.delete(id); } },
  };
}
