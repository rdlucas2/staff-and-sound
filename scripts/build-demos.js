// Builds the example MIDI files in demos/ from text notation.
// Run with: npm install && npm run demos
// All pieces are public domain; these are simple arrangements.
import { writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { parse, toEvents } from '../js/notation.js';

const require = createRequire(import.meta.url);
const { Midi } = require('@tonejs/midi');

const rep = (s, n) => Array(n).fill(s).join(' | ');

const PIECES = [
  {
    file: 'minuet-in-g.mid',
    title: 'Minuet in G',
    ts: [3, 4], bpm: 112,
    key: 'G',
    tracks: [
      { name: 'Right hand', program: 6, text:
        'D5/q G4/8 A4 B4 C5 | D5/q G4 G4 | E5/q C5/8 D5 E5 F#5 | G5/q G4 G4 | C5/q D5/8 C5 B4 A4 | B4/q C5/8 B4 A4 G4 | F#4/q G4/8 A4 B4 G4 | A4/h. | ' +
        'D5/q G4/8 A4 B4 C5 | D5/q G4 G4 | E5/q C5/8 D5 E5 F#5 | G5/q G4 G4 | C5/q D5/8 C5 B4 A4 | B4/q C5/8 B4 A4 G4 | A4/q B4/8 A4 G4 F#4 | G4/h.' },
      { name: 'Left hand', program: 6, text:
        'G3/h A3/q | B3/h. | C4/h. | B3/h. | A3/h. | G3/h. | D4/q B3 G3 | D4/q D3/8 C4 B3 A3 | ' +
        'B3/h A3/q | G3/q B3 G3 | C4/h. | B3/q C4/8 B3 A3 G3 | A3/h F#3/q | G3/h B3/q | C4/q D4 D3 | G3/h G2/q' },
    ],
  },
  {
    file: 'canon-in-d.mid',
    title: 'Canon in D',
    ts: [4, 4], bpm: 66,
    key: 'D',
    tracks: (() => {
      const L1 = 'F#5/q E5 D5 C#5 | B4 A4 B4 C#5';
      const L2 = 'D5/q C#5 B4 A4 | G4 F#4 G4 E4';
      const L3 = 'D5/8 F#5 A5 G5 F#5 D5 F#5 E5 | D5 B4 D5 A5 G5 B5 A5 G5';
      const theme = [L1, L2, L3, L1, L2, L3].join(' | ');
      const rests = (bars) => (bars ? rep('r/w', bars) + ' | ' : '');
      const violin = (entry, after, last) => rests(entry) + theme + ' | ' + rests(after) + `${last}/w`;
      return [
        { name: 'Violin I', program: 40, text: violin(2, 4, 'F#5') },
        { name: 'Violin II', program: 40, text: violin(4, 2, 'D5') },
        { name: 'Violin III', program: 40, text: violin(6, 0, 'A4') },
        { name: 'Cello', program: 42, text: rep('D3/q A2 B2 F#2 | G2 D2 G2 A2', 9) + ' | D3/w' },
      ];
    })(),
  },
  {
    file: 'twinkle-twinkle.mid',
    title: 'Twinkle, Twinkle, Little Star',
    ts: [4, 4], bpm: 100,
    key: 'C',
    tracks: [
      { name: 'Melody', program: 0, text:
        'C4/q C4 G4 G4 | A4 A4 G4/h | F4/q F4 E4 E4 | D4 D4 C4/h | G4/q G4 F4 F4 | E4 E4 D4/h | G4/q G4 F4 F4 | E4 E4 D4/h | ' +
        'C4/q C4 G4 G4 | A4 A4 G4/h | F4/q F4 E4 E4 | D4 D4 C4/h' },
      { name: 'Bass', program: 32, text:
        'C3/h E3 | F3/h E3 | D3/h C3 | G2/h C3 | E3/h D3 | C3/h G2 | E3/h D3 | C3/h G2 | C3/h E3 | F3/h E3 | D3/h C3 | G2/h C3/h' },
    ],
  },
];

mkdirSync(new URL('../demos/', import.meta.url), { recursive: true });
for (const piece of PIECES) {
  const midi = new Midi();
  midi.header.setTempo(piece.bpm);
  midi.header.timeSignatures.push({ ticks: 0, timeSignature: piece.ts });
  midi.header.keySignatures.push({ ticks: 0, key: piece.key, scale: 'major' });
  midi.header.name = piece.title;
  midi.header.update();
  piece.tracks.forEach((t, i) => {
    const r = parse(t.text);
    if (r.error) throw new Error(`${piece.title} / ${t.name}: can't parse "${r.error}"`);
    const track = midi.addTrack();
    track.name = t.name;
    track.channel = i;
    track.instrument.number = t.program;
    for (const ev of toEvents(r.notes, piece.bpm).events) {
      for (const m of ev.midis) track.addNote({ midi: m, time: ev.t, duration: ev.dur * 0.95, velocity: 0.75 });
    }
  });
  writeFileSync(new URL(`../demos/${piece.file}`, import.meta.url), Buffer.from(midi.toArray()));
  console.log(`demos/${piece.file}  ${piece.title}  (${piece.tracks.length} tracks)`);
}
