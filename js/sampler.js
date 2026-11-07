// Sampler data: recording from the microphone, loading audio files, trimming, and storage.
// The current sample is shared by every "sampler" sound on both pages and kept in IndexedDB.

export const MAX_RECORD_SECONDS = 5;
export const MAX_FILE_SECONDS = 10;

export const defaultSettings = () => ({
  name: 'My sound', root: 60, start: 0, end: 1, reverse: false, loop: false,
  attack: 0.005, release: 0.25, level: 0,
});

/** Mix an AudioBuffer down to one channel (Float32Array), capped at maxSeconds. */
export function toMono(audioBuffer, maxSeconds = MAX_FILE_SECONDS) {
  const len = Math.min(audioBuffer.length, Math.round(maxSeconds * audioBuffer.sampleRate));
  const out = new Float32Array(len);
  for (let c = 0; c < audioBuffer.numberOfChannels; c++) {
    const d = audioBuffer.getChannelData(c);
    for (let i = 0; i < len; i++) out[i] += d[i] / audioBuffer.numberOfChannels;
  }
  return out;
}

/** Scale so the loudest sample sits at `peak`. */
export function normalize(pcm, peak = 0.9) {
  let max = 0;
  for (let i = 0; i < pcm.length; i++) max = Math.max(max, Math.abs(pcm[i]));
  if (max < 1e-4) return pcm;
  const k = peak / max;
  for (let i = 0; i < pcm.length; i++) pcm[i] *= k;
  return pcm;
}

/**
 * Find where the sound starts and stops: the first and last 5 ms windows louder than
 * `thresholdDb` below the peak. Returns { start, end } as fractions of the length.
 */
export function autoTrim(pcm, sampleRate, thresholdDb = -38) {
  const win = Math.max(1, Math.round(sampleRate * 0.005));
  let peak = 0;
  for (let i = 0; i < pcm.length; i++) peak = Math.max(peak, Math.abs(pcm[i]));
  if (peak < 1e-4) return { start: 0, end: 1 };
  const limit = peak * Math.pow(10, thresholdDb / 20);
  const loud = (i) => {
    let m = 0;
    for (let j = i; j < Math.min(pcm.length, i + win); j++) m = Math.max(m, Math.abs(pcm[j]));
    return m > limit;
  };
  let a = 0, b = pcm.length - win;
  while (a < pcm.length && !loud(a)) a += win;
  while (b > a && !loud(b)) b -= win;
  const pad = Math.round(sampleRate * 0.01);
  return { start: Math.max(0, a - pad) / pcm.length, end: Math.min(pcm.length, b + win + pad * 3) / pcm.length };
}

/** A built-in sound so the sampler works before anything is recorded: a kalimba-like tine at C4. */
export function demoSample(sampleRate = 44100) {
  const len = Math.round(sampleRate * 1.6), f = 261.63;
  const pcm = new Float32Array(len);
  const partials = [[1, 1, 2.2], [2.76, 0.32, 5], [5.4, 0.16, 9], [8.93, 0.06, 14]];
  let seed = 7;
  const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let i = 0; i < len; i++) {
    const t = i / sampleRate;
    let v = 0;
    for (const [ratio, amp, decay] of partials) v += amp * Math.sin(2 * Math.PI * f * ratio * t) * Math.exp(-decay * t);
    v += noise() * 0.25 * Math.exp(-t * 180); // the click of the tine
    pcm[i] = v * Math.min(1, t / 0.002);
  }
  return { pcm: normalize(pcm), sampleRate, settings: { ...defaultSettings(), name: 'Kalimba (built-in)', root: 60, release: 0.4 } };
}

// ---------- recording ----------

/** Why the microphone can't be used here, or null if it might work. */
export function micUnavailableReason() {
  if (!window.isSecureContext) return 'The microphone only works over HTTPS or on localhost.';
  if (!navigator.mediaDevices?.getUserMedia) return 'This browser has no microphone access.';
  if (!window.MediaRecorder) return 'This browser can\'t record audio.';
  return null;
}

/**
 * Record from the mic. Returns a controller: { stop(), done: Promise<{ pcm, sampleRate }> }.
 * onLevel(0–1) is called about 30 times a second; recording stops on its own after maxSeconds.
 */
export async function startRecording(audioContext, { maxSeconds = MAX_RECORD_SECONDS, onLevel } = {}) {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
  } catch (e) {
    const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
    throw new Error(denied
      ? 'Microphone access was blocked. Allow it in the browser, or load an audio file instead.'
      : 'No microphone was found. Plug one in, or load an audio file instead.');
  }
  const source = audioContext.createMediaStreamSource(stream);
  const analyser = audioContext.createAnalyser();
  analyser.fftSize = 1024;
  source.connect(analyser);
  const buf = new Float32Array(analyser.fftSize);
  let raf = 0;
  const meter = () => {
    analyser.getFloatTimeDomainData(buf);
    let peak = 0;
    for (const v of buf) peak = Math.max(peak, Math.abs(v));
    onLevel?.(Math.min(1, peak));
    raf = requestAnimationFrame(meter);
  };
  meter();

  const chunks = [];
  const rec = new MediaRecorder(stream);
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const done = new Promise((resolve, reject) => {
    rec.onstop = async () => {
      cancelAnimationFrame(raf);
      onLevel?.(0);
      source.disconnect();
      stream.getTracks().forEach((t) => t.stop());
      try {
        const audio = await audioContext.decodeAudioData(await new Blob(chunks, { type: rec.mimeType }).arrayBuffer());
        resolve({ pcm: toMono(audio, maxSeconds), sampleRate: audio.sampleRate });
      } catch {
        reject(new Error('The recording couldn\'t be decoded. Try again, or load an audio file.'));
      }
    };
  });
  rec.start();
  const timer = setTimeout(() => rec.state === 'recording' && rec.stop(), maxSeconds * 1000);
  return {
    stop: () => { clearTimeout(timer); if (rec.state === 'recording') rec.stop(); },
    done,
  };
}

/** Decode an audio file (WAV, MP3, OGG…) to mono. */
export async function decodeFile(audioContext, file) {
  try {
    const audio = await audioContext.decodeAudioData(await file.arrayBuffer());
    return { pcm: toMono(audio), sampleRate: audio.sampleRate };
  } catch {
    throw new Error(`“${file.name}” couldn't be read as audio. Try a WAV, MP3 or OGG file.`);
  }
}

// ---------- storage (IndexedDB; samples are too big for localStorage) ----------
const DB_NAME = 'staff-and-sound', STORE = 'samples', KEY = 'current';
function openDb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
/** Save { pcm, sampleRate, settings }. Resolves false if storage isn't available. */
export async function saveSample(sample) {
  try {
    const db = await openDb();
    await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(sample, KEY);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    return true;
  } catch { return false; }
}
export async function loadSample() {
  try {
    const db = await openDb();
    return await new Promise((resolve) => {
      const r = db.transaction(STORE).objectStore(STORE).get(KEY);
      r.onsuccess = () => resolve(r.result || null);
      r.onerror = () => resolve(null);
    });
  } catch { return null; }
}
