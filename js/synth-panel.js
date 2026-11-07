// Synth patch editor: a front panel of grouped sliders, built from CONTROLS in synth.js.
// Used on the main page (for "Synth" parts) and on the freeplay page.
import { CONTROLS, PRESETS, getPath, setPath, formatValue, normalizePatch } from './synth.js';

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const SLIDER_STEPS = 1000;

// Log-scaled sliders for times, frequencies and resonance: position 0..1000 <-> value.
const toPos = (c, v) => c.scale === 'log'
  ? Math.round((Math.log(v / c.min) / Math.log(c.max / c.min)) * SLIDER_STEPS)
  : v;
const fromPos = (c, pos) => {
  if (c.scale !== 'log') return +pos;
  const v = c.min * Math.pow(c.max / c.min, pos / SLIDER_STEPS);
  return +v.toPrecision(3);
};

function envPath(env) {
  // Attack, decay, sustain hold, release drawn into a 100x36 box (times log-compressed).
  const t = (s) => 6 + Math.log1p(s * 6) * 9;
  const a = t(env.attack), d = t(env.decay), r = t(env.release), hold = 16;
  const total = a + d + hold + r;
  const k = 96 / total;
  const top = 3, bottom = 33, sus = bottom - (bottom - top) * env.sustain;
  const x1 = 2 + a * k, x2 = x1 + d * k, x3 = x2 + hold * k, x4 = x3 + r * k;
  return `M2 ${bottom} L${x1.toFixed(1)} ${top} L${x2.toFixed(1)} ${sus.toFixed(1)} L${x3.toFixed(1)} ${sus.toFixed(1)} L${x4.toFixed(1)} ${bottom}`;
}

/**
 * Mount the editor in `el`.
 * getPatch(): the patch object to edit (mutated in place)
 * onChange(patch, { structural }): called on every change; structural = presets, toggles, selects
 * Returns { refresh() } to redraw after the patch is replaced from outside.
 */
export function mountSynthPanel(el, { getPatch, onChange, idPrefix = 'syn' }) {
  const presetSelect = () => {
    const p = getPatch();
    const known = PRESETS.some((x) => x.name === p.name);
    return `<select id="${idPrefix}-preset" class="syn-preset" aria-label="Preset">
      ${known ? '' : `<option value="" selected>${esc(p.name)}</option>`}
      ${PRESETS.map((x, i) => `<option value="${i}"${x.name === p.name ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}
    </select>`;
  };

  const control = (c, p) => {
    const v = getPath(p, c.path);
    const id = `${idPrefix}-${c.path.replace('.', '-')}`;
    if (c.kind === 'select') {
      return `<label class="syn-ctl" for="${id}"><span class="syn-label">${c.label}</span>
        <select id="${id}" data-path="${c.path}">${c.options.map((o) => `<option value="${o}"${o === v ? ' selected' : ''}>${o}</option>`).join('')}</select></label>`;
    }
    if (c.kind === 'toggle') {
      return `<label class="syn-ctl syn-toggle" for="${id}"><input type="checkbox" id="${id}" data-path="${c.path}"${v ? ' checked' : ''}><span class="syn-label">${c.label}</span></label>`;
    }
    const max = c.scale === 'log' ? SLIDER_STEPS : c.max, min = c.scale === 'log' ? 0 : c.min, step = c.scale === 'log' ? 1 : c.step;
    return `<label class="syn-ctl" for="${id}"><span class="syn-label">${c.label}</span>
      <input type="range" id="${id}" data-path="${c.path}" min="${min}" max="${max}" step="${step}" value="${toPos(c, v)}">
      <output class="syn-val" for="${id}">${formatValue(c, v)}</output></label>`;
  };

  function render() {
    const p = getPatch();
    el.innerHTML = `<div class="syn-head">
        <span class="syn-title">Patch</span>${presetSelect()}
        <span class="syn-hint">Play the keyboard to hear changes as you make them.</span>
      </div>
      <div class="syn-groups">${CONTROLS.map((g) => `
        <fieldset class="syn-group">
          <legend>${g.group}</legend>
          ${g.env ? `<svg class="syn-env" viewBox="0 0 100 36" aria-hidden="true"><path data-env="${g.env}" d="${envPath(p[g.env])}"/></svg>` : ''}
          ${g.items.filter((c) => !c.when || c.when(p)).map((c) => control(c, p)).join('')}
        </fieldset>`).join('')}
      </div>`;
  }

  const findControl = (path) => CONTROLS.flatMap((g) => g.items).find((c) => c.path === path);

  el.addEventListener('input', (e) => {
    const path = e.target.dataset.path;
    if (!path || e.target.type !== 'range') return;
    const c = findControl(path);
    const p = getPatch();
    const v = fromPos(c, e.target.value);
    setPath(p, path, v);
    p.name = PRESETS.some((x) => x.name === p.name) ? `${p.name} (edited)` : p.name;
    const out = e.target.parentElement.querySelector('.syn-val');
    if (out) out.textContent = formatValue(c, v);
    const env = path.split('.')[0];
    const curve = el.querySelector(`[data-env="${env}"]`);
    if (curve) curve.setAttribute('d', envPath(p[env]));
    const sel = el.querySelector('.syn-preset');
    if (sel && sel.value !== '') { sel.insertAdjacentHTML('afterbegin', `<option value="" selected>${esc(p.name)}</option>`); sel.value = ''; }
    onChange(p, { structural: false });
  });

  el.addEventListener('change', (e) => {
    const p = getPatch();
    if (e.target.classList.contains('syn-preset')) {
      const preset = PRESETS[+e.target.value];
      if (!preset) return;
      const fresh = normalizePatch(structuredClone(preset));
      for (const k of Object.keys(p)) delete p[k];
      Object.assign(p, fresh);
      render();
      onChange(p, { structural: true });
      return;
    }
    const path = e.target.dataset.path;
    if (!path || e.target.type === 'range') return;
    setPath(p, path, e.target.type === 'checkbox' ? e.target.checked : e.target.value);
    if (!/\(edited\)$/.test(p.name) && PRESETS.some((x) => x.name === p.name)) p.name = `${p.name} (edited)`;
    render();
    el.querySelector(`[data-path="${path}"]`)?.focus();
    onChange(p, { structural: true });
  });

  render();
  return { refresh: render };
}
