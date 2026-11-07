// Sampler editor: record or load a sound, see its waveform, trim it, choose its root note and envelope.
// Holds the one shared sample for the page and keeps it in IndexedDB.
import * as audio from './audio.js';
import {
  defaultSettings, normalize, autoTrim, demoSample, micUnavailableReason,
  startRecording, decodeFile, saveSample, loadSample, MAX_RECORD_SECONDS,
} from './sampler.js';

const NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const noteName = (m) => NAMES[m % 12] + (Math.floor(m / 12) - 1);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let current = null;   // { pcm, sampleRate, settings, builtIn? }
let saveTimer;

/** Load the saved sample (or the built-in one) into the audio engine. Call once per page. */
export async function initSampler() {
  const saved = await loadSample();
  current = saved?.pcm?.length ? { ...saved, settings: { ...defaultSettings(), ...saved.settings } } : { ...demoSample(), builtIn: true };
  audio.setSample(current);
  return current;
}

function persist() {
  clearTimeout(saveTimer);
  if (current?.builtIn) return;
  saveTimer = setTimeout(() => saveSample({ pcm: current.pcm, sampleRate: current.sampleRate, settings: current.settings }), 300);
}

/**
 * Mount the editor. onChange() is called after a new sound arrives (so pages can switch to it);
 * preview(midi) should play a note through a sampler sound.
 */
export function mountSamplerPanel(el, { idPrefix = 'smp', onNewSound, preview }) {
  const id = (s) => `${idPrefix}-${s}`;
  el.innerHTML = `
    <div class="smp-head">
      <button class="smp-rec" id="${id('rec')}" type="button"><span class="smp-dot" aria-hidden="true"></span><span class="smp-rec-label">Record</span></button>
      <div class="smp-meter" aria-hidden="true"><span id="${id('meter')}"></span></div>
      <label class="ghost file-btn" for="${id('file')}">Load audio file…<input type="file" id="${id('file')}" accept="audio/*,.wav,.mp3,.ogg,.m4a,.flac"></label>
      <button class="ghost" id="${id('demo')}" type="button">Built-in sound</button>
    </div>
    <p class="smp-status" id="${id('status')}"></p>
    <div class="smp-wave-wrap"><canvas class="smp-wave" id="${id('wave')}" height="96"></canvas></div>
    <div class="smp-controls" id="${id('controls')}"></div>`;
  const $ = (s) => el.querySelector('#' + id(s));
  const setStatus = (text, tone = '') => { const s = $('status'); s.textContent = text; s.dataset.tone = tone; };

  function describe() {
    if (!current) return setStatus('No sound yet. Record one or load an audio file.');
    const secs = (current.pcm.length / current.sampleRate).toFixed(1);
    setStatus(current.builtIn
      ? `Using the built-in kalimba. Record or load your own sound to replace it.`
      : `“${current.settings.name}”, ${secs} s. Play the keyboard to hear it; root note ${noteName(current.settings.root)}.`, current.builtIn ? '' : 'ok');
  }

  // ---- waveform ----
  function draw() {
    const c = $('wave');
    const w = c.clientWidth || 600, h = 96, dpr = window.devicePixelRatio || 1;
    c.width = Math.round(w * dpr); c.height = Math.round(h * dpr);
    const g = c.getContext('2d');
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const css = getComputedStyle(el);
    const ink = css.getPropertyValue('--ink').trim() || '#222', accent = css.getPropertyValue('--accent').trim() || '#8a2f5e';
    const bg = css.getPropertyValue('--bg').trim() || '#eee';
    if (!current) return;
    const { pcm, settings: st } = current;
    const step = pcm.length / w;
    g.fillStyle = ink;
    for (let x = 0; x < w; x++) {
      let lo = 1, hi = -1;
      const a = Math.floor(x * step), b = Math.min(pcm.length, Math.floor((x + 1) * step) + 1);
      for (let i = a; i < b; i++) { const v = pcm[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
      const y1 = (1 - (hi + 1) / 2) * h, y2 = (1 - (lo + 1) / 2) * h;
      g.fillRect(x, y1, 1, Math.max(1, y2 - y1));
    }
    // Dim what's trimmed off; mark the start and end.
    g.globalAlpha = 0.72;
    g.fillStyle = bg;
    g.fillRect(0, 0, st.start * w, h);
    g.fillRect(st.end * w, 0, w - st.end * w, h);
    g.globalAlpha = 1;
    g.fillStyle = accent;
    g.fillRect(Math.round(st.start * w) - 1, 0, 2, h);
    g.fillRect(Math.round(st.end * w) - 1, 0, 2, h);
    // Tags in the top-right corner, on their own background so they stay readable over the wave.
    g.font = '600 10px system-ui, sans-serif';
    let x = w - 4;
    for (const tag of [st.reverse && 'REVERSED', st.loop && 'LOOP'].filter(Boolean)) {
      const tw = g.measureText(tag).width + 10;
      x -= tw;
      g.fillStyle = bg; g.fillRect(x, 4, tw, 16);
      g.fillStyle = accent; g.fillText(tag, x + 5, 15.5);
      x -= 4;
    }
  }

  // ---- controls ----
  const fmtTime = (frac) => `${((current ? current.pcm.length / current.sampleRate : 0) * frac).toFixed(2)} s`;
  const fmtMs = (s) => (s < 1 ? `${Math.round(s * 1000)} ms` : `${s.toFixed(2)} s`);
  function controls() {
    const st = current?.settings || defaultSettings();
    const roots = [];
    for (let m = 36; m <= 84; m++) roots.push(`<option value="${m}"${m === st.root ? ' selected' : ''}>${noteName(m)}</option>`);
    const range = (key, label, min, max, step, value, text) => `<label class="syn-ctl" for="${id(key)}"><span class="syn-label">${label}</span>
      <input type="range" id="${id(key)}" data-key="${key}" min="${min}" max="${max}" step="${step}" value="${value}"><output class="syn-val">${text}</output></label>`;
    $('controls').innerHTML = `
      <fieldset class="syn-group"><legend>Trim</legend>
        ${range('start', 'Start', 0, 1000, 1, Math.round(st.start * 1000), fmtTime(st.start))}
        ${range('end', 'End', 0, 1000, 1, Math.round(st.end * 1000), fmtTime(st.end))}
        <div class="smp-buttons"><button class="ghost" type="button" data-act="autotrim">Auto-trim silence</button></div>
      </fieldset>
      <fieldset class="syn-group"><legend>Pitch</legend>
        <label class="syn-ctl" for="${id('root')}"><span class="syn-label">Root note</span><select id="${id('root')}" data-key="root">${roots.join('')}</select></label>
        <p class="smp-help">The key that plays the sound at its recorded pitch.</p>
        <div class="smp-buttons"><button class="ghost" type="button" data-act="preview">Play root note</button></div>
      </fieldset>
      <fieldset class="syn-group"><legend>Shape</legend>
        ${range('attack', 'Attack', 0, 1000, 1, Math.round(Math.sqrt(st.attack / 2) * 1000), fmtMs(st.attack))}
        ${range('release', 'Release', 0, 1000, 1, Math.round(Math.sqrt(st.release / 4) * 1000), fmtMs(st.release))}
        ${range('level', 'Level', -24, 6, 0.5, st.level, `${st.level > 0 ? '+' : ''}${st.level} dB`)}
        <label class="syn-ctl syn-toggle" for="${id('loop')}"><input type="checkbox" id="${id('loop')}" data-key="loop"${st.loop ? ' checked' : ''}><span class="syn-label">Loop while held</span></label>
        <label class="syn-ctl syn-toggle" for="${id('reverse')}"><input type="checkbox" id="${id('reverse')}" data-key="reverse"${st.reverse ? ' checked' : ''}><span class="syn-label">Reverse</span></label>
      </fieldset>
      <fieldset class="syn-group"><legend>Name</legend>
        <input class="smp-name" id="${id('name')}" data-key="name" maxlength="30" value="${esc(st.name)}" aria-label="Sound name">
      </fieldset>`;
    $('controls').querySelectorAll('fieldset').forEach((f) => { f.disabled = !current; });
  }

  function install(data, label) {
    const pcm = normalize(data.pcm);
    const trim = autoTrim(pcm, data.sampleRate);
    current = { pcm, sampleRate: data.sampleRate, settings: { ...defaultSettings(), ...trim, name: label } };
    audio.setSample(current);
    persist();
    controls();
    draw();
    describe();
    onNewSound?.();
  }

  $('controls').addEventListener('input', (e) => {
    const key = e.target.dataset.key;
    if (!key || !current) return;
    const st = current.settings;
    const out = e.target.parentElement.querySelector('output');
    const v = +e.target.value;
    if (key === 'start') { st.start = Math.min(v / 1000, st.end - 0.005); out.textContent = fmtTime(st.start); }
    if (key === 'end') { st.end = Math.max(v / 1000, st.start + 0.005); out.textContent = fmtTime(st.end); }
    if (key === 'attack') { st.attack = Math.max(0.001, Math.pow(v / 1000, 2) * 2); out.textContent = fmtMs(st.attack); }
    if (key === 'release') { st.release = Math.max(0.01, Math.pow(v / 1000, 2) * 4); out.textContent = fmtMs(st.release); }
    if (key === 'level') { st.level = v; out.textContent = `${v > 0 ? '+' : ''}${v} dB`; }
    if (key === 'name') { st.name = e.target.value.trim() || 'My sound'; describe(); }
    audio.setSampleSettings(st);
    if (key === 'start' || key === 'end') draw();
    persist();
  });
  $('controls').addEventListener('change', (e) => {
    const key = e.target.dataset.key;
    if (!key || !current) return;
    const st = current.settings;
    if (key === 'root') { st.root = +e.target.value; audio.setSampleSettings(st); describe(); }
    if (key === 'loop') { st.loop = e.target.checked; audio.setSampleSettings(st); }
    if (key === 'reverse') { st.reverse = e.target.checked; audio.setSample(current); }
    draw();
    persist();
  });
  $('controls').addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act || !current) return;
    if (act === 'autotrim') {
      Object.assign(current.settings, autoTrim(current.pcm, current.sampleRate));
      audio.setSampleSettings(current.settings);
      controls(); draw(); persist();
    }
    if (act === 'preview') preview?.(current.settings.root);
  });

  // ---- recording ----
  let recording = null;
  $('rec').addEventListener('click', async () => {
    if (recording) { recording.stop(); return; }
    const reason = micUnavailableReason();
    if (reason) { setStatus(`${reason} Load an audio file instead.`, 'warn'); return; }
    await audio.unlock();
    const btn = $('rec');
    try {
      recording = await startRecording(window.Tone.getContext().rawContext, {
        onLevel: (v) => { $('meter').style.width = `${Math.round(v * 100)}%`; },
      });
    } catch (err) {
      setStatus(err.message, 'warn');
      return;
    }
    btn.classList.add('on');
    btn.querySelector('.smp-rec-label').textContent = 'Stop';
    setStatus(`Recording… up to ${MAX_RECORD_SECONDS} seconds. Click Stop when you're done.`);
    try {
      const data = await recording.done;
      const stamp = new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
      install(data, `Recording ${stamp}`);
    } catch (err) {
      setStatus(err.message, 'warn');
    } finally {
      recording = null;
      btn.classList.remove('on');
      btn.querySelector('.smp-rec-label').textContent = 'Record';
    }
  });

  $('file').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    await audio.unlock();
    try {
      const data = await decodeFile(window.Tone.getContext().rawContext, file);
      install(data, file.name.replace(/\.[^.]+$/, '').slice(0, 30));
    } catch (err) {
      setStatus(err.message, 'warn');
    }
  });

  $('demo').addEventListener('click', () => {
    current = { ...demoSample(), builtIn: true };
    audio.setSample(current);
    saveSample({ pcm: new Float32Array(0), sampleRate: 44100, settings: defaultSettings() }); // forget the saved one
    controls(); draw(); describe();
    onNewSound?.();
  });

  new ResizeObserver(() => draw()).observe($('wave'));
  controls();
  draw();
  describe();
  if (micUnavailableReason()) $('rec').title = micUnavailableReason();
  return { refresh: () => { controls(); draw(); describe(); } };
}
