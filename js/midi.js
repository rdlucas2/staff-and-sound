// MIDI file export (@tonejs/midi) and live MIDI keyboard input (Web MIDI API).
import { toEvents } from './notation.js';
import { makeZip } from './zip.js';

/** Build a Standard MIDI File (Uint8Array) from the note model. */
export function buildMidiFile(notes, { bpm, ts, name = 'Staff & Sound' }) {
  const midi = new window.Midi();
  const [n, d] = ts.split('/').map(Number);
  midi.header.setTempo(bpm);
  midi.header.timeSignatures.push({ ticks: 0, timeSignature: [n, d] });
  midi.header.name = name;
  midi.header.update();
  const track = midi.addTrack();
  track.name = name;
  track.instrument.number = 0; // Acoustic Grand Piano
  const { events } = toEvents(notes, bpm);
  for (const ev of events) {
    for (const m of ev.midis) track.addNote({ midi: m, time: ev.t, duration: ev.dur * 0.98, velocity: 0.8 });
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
