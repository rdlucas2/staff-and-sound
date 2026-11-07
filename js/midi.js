// MIDI file export (@tonejs/midi) and live MIDI keyboard input (Web MIDI API).
import { makeZip } from './zip.js';
import { GM_DRUMS } from './band.js';

// General MIDI program numbers for each sound, so other software picks a similar instrument.
export const GM_PROGRAM = { piano: 0, epiano: 4, organ: 16, guitar: 24, upright: 32, ebass: 33, pluck: 45, strings: 48, chip: 80 };
const clamp = (v) => Math.max(0.05, Math.min(1, v));

/**
 * Build a Standard MIDI File (Uint8Array) from a playback plan (see plan.js):
 * one track per part, plus the band's comping and bass, and drums on channel 10.
 * Timing is as heard, so swung styles export swung. Muted band instruments are left out.
 */
export function buildMidiFile(plan, { bpm, ts, name = 'Staff & Sound' }) {
  const midi = new window.Midi();
  const [n, d] = ts.split('/').map(Number);
  midi.header.setTempo(bpm);
  midi.header.timeSignatures.push({ ticks: 0, timeSignature: [n, d] });
  midi.header.name = name;
  midi.header.update();
  let channel = 0;
  for (const tr of plan.tracks) {
    if (tr.key !== 'part' && tr.part.mute) continue;
    const track = midi.addTrack();
    track.name = tr.name;
    const gain = Math.pow(10, (tr.part.volume || 0) / 40);
    if (tr.key === 'drums') {
      track.channel = 9; // General MIDI percussion
      for (const ev of tr.events) {
        const note = GM_DRUMS[ev.drum];
        if (note) track.addNote({ midi: note, time: ev.t, duration: 0.1, velocity: clamp((ev.vel ?? 0.8) * gain) });
      }
      continue;
    }
    if (channel === 9) channel++; // channel 10 is reserved for drums
    track.channel = channel++ % 16;
    track.instrument.number = GM_PROGRAM[tr.part.sound] ?? 0;
    for (const ev of tr.events) {
      for (const m of ev.midis || []) {
        track.addNote({ midi: m, time: ev.t, duration: Math.max(0.03, ev.dur * 0.98), velocity: clamp((ev.vel ?? 0.8) * gain) });
      }
    }
  }
  return midi.toArray();
}

/**
 * Save the MIDI bytes. Inside the claude.ai artifact viewer, downloads go through the
 * `downloads` capability, which doesn't accept .mid, so the file is wrapped in a .zip.
 * Everywhere else it's a plain .mid download.
 * Resolves to 'mid' | 'zip'; rejects with an Error whose message is shown to the user.
 */
export async function saveMidi(bytes, baseName = 'staff-and-sound') {
  const viewer = window.claude?.use ? await window.claude.use('downloads') : null;
  if (viewer) {
    const zip = makeZip([{ name: baseName + '.mid', data: bytes }]);
    try {
      await viewer.save({ filename: baseName + '-midi.zip', data: new Blob([zip]) });
      return 'zip';
    } catch (e) {
      if (e?.code === 'declined') throw new Error('Download cancelled.');
      throw new Error('This view can\'t save files. Open the standalone version to export.');
    }
  }
  const url = URL.createObjectURL(new Blob([bytes], { type: 'audio/midi' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: baseName + '.mid' });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  return 'mid';
}

/**
 * Connect to MIDI keyboards. Calls handlers for note on/off from every input,
 * and onDevices(names[]) whenever devices come and go.
 * Rejects with an Error describing why MIDI isn't available.
 */
export async function connectMidiInput({ onNoteOn, onNoteOff, onDevices }) {
  if (!navigator.requestMIDIAccess) {
    throw new Error('This browser has no Web MIDI support. Try Chrome, Edge or Firefox.');
  }
  let access;
  try {
    access = await navigator.requestMIDIAccess({ sysex: false });
  } catch (e) {
    throw new Error('MIDI access was blocked. Allow it in the browser, or run the standalone version over HTTPS or localhost.');
  }
  const onMessage = (msg) => {
    const [status, d1, d2] = msg.data;
    const cmd = status & 0xf0;
    if (cmd === 0x90 && d2 > 0) onNoteOn(d1, d2 / 127);
    else if (cmd === 0x80 || (cmd === 0x90 && d2 === 0)) onNoteOff(d1);
  };
  const bind = () => {
    const names = [];
    access.inputs.forEach((input) => {
      input.onmidimessage = onMessage;
      names.push(input.name || 'MIDI input');
    });
    onDevices(names);
  };
  access.onstatechange = bind;
  bind();
  return access;
}
