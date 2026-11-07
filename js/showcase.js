// Showcase demo songs: original pieces written for Staff & Sound by Claude (Anthropic), MIT licensed
// like the rest of the code. Each is plain data: tempo, time signature, a chord chart for the
// backing band, and parts in the text notation (see notation.js). Pure module; runs in Node.

// ---------- little helpers for writing music as text ----------
const bars = (...b) => b.join(' | ');
const rests = (n, bar = 'r/w') => Array(n).fill(bar).join(' | ');
/** Move every pitch in a passage by whole octaves. */
export const octave = (text, n) => text.replace(/([A-G](?:##|bb|#|b|n)?)(\d)/g, (_, p, o) => p + (+o + n));
/** Give the notes in a passage velocities ramping from `from` to `to` (0–127): crescendos and fades. */
export function ramp(text, from, to) {
  const toks = text.match(/\([^)]*\)\S*|[^\s|]+|\|/g) || []; // keep chords like (C4 E4)/h whole
  const notes = toks.map((t, i) => (t !== '|' && !/^r(\/|$)/i.test(t) && !t.includes(':') ? i : -1)).filter((i) => i >= 0);
  notes.forEach((i, k) => {
    const v = Math.round(from + ((to - from) * k) / Math.max(1, notes.length - 1));
    toks[i] += ':' + v;
  });
  return toks.join(' ');
}

// ---------- sounds ----------
const TENOR = {
  name: 'Tenor Lead', gm: 66,
  osc: { type: 'sawtooth' }, osc2: { on: true, type: 'square', octave: -1, detune: 4, level: 0.22 },
  amp: { attack: 0.025, decay: 0.25, sustain: 0.8, release: 0.14 },
  filter: { cutoff: 1250, q: 2.2, env: 1.6, attack: 0.03, decay: 0.3, sustain: 0.45, release: 0.2 },
  lfo: { vibRate: 5.2, vibDepth: 0.07 },
  fx: { chorus: 0.12, reverb: 0.28 }, level: -9,
};
const BRASS = {
  name: 'Section Brass', gm: 61,
  osc: { type: 'sawtooth', voices: 3, spread: 16 },
  amp: { attack: 0.04, decay: 0.25, sustain: 0.75, release: 0.2 },
  filter: { cutoff: 700, q: 1.8, env: 2.6, attack: 0.05, decay: 0.35, sustain: 0.5, release: 0.25 },
  fx: { chorus: 0.2, reverb: 0.3 }, level: -9,
};
const FLUTE = {
  name: 'Bossa Flute', gm: 73,
  osc: { type: 'triangle' }, osc2: { on: true, type: 'sine', octave: 1, detune: 2, level: 0.18 },
  amp: { attack: 0.06, decay: 0.3, sustain: 0.82, release: 0.28 },
  filter: { cutoff: 3600, q: 0.7, env: 0.6, attack: 0.05, decay: 0.4, sustain: 0.6, release: 0.3 },
  lfo: { vibRate: 5.3, vibDepth: 0.11 },
  fx: { delay: 0.12, reverb: 0.38 }, level: -6,
};
const BELL = {
  name: 'Glass Bell', gm: 14,
  osc: { type: 'sine' }, osc2: { on: true, type: 'triangle', octave: 2, semi: 7, detune: 3, level: 0.3 },
  amp: { attack: 0.002, decay: 1.8, sustain: 0, release: 2 },
  filter: { cutoff: 9000, q: 0.5 },
  fx: { chorus: 0.25, delay: 0.18, reverb: 0.55 }, level: -11,
};
const CLAV = {
  name: 'Wah Clav', gm: 7,
  osc: { type: 'pulse', width: 0.32 },
  amp: { attack: 0.002, decay: 0.25, sustain: 0.25, release: 0.08 },
  filter: { type: 'bandpass', cutoff: 650, q: 4.5, env: 3.4, attack: 0.002, decay: 0.16, sustain: 0.15, release: 0.08 },
  fx: { reverb: 0.08 }, level: 1,
};
const band = (style, chart, seed, mix = {}) => ({
  on: true, style, seed, chart,
  comp: { volume: -6, mute: false, ...mix.comp },
  bass: { volume: -3, mute: false, ...mix.bass },
  drums: { volume: -6, mute: false, ...mix.drums },
});

// ---------- 1. Blue Ember: a jazz-swing blues in F ----------
const BLUES = ['F7', 'Bb7', 'F7', 'Cm7 F7', 'Bb7', 'Bdim7', 'F7', 'Am7b5 D7b9', 'Gm7', 'C7', 'F7 D7', 'Gm7 C7'];
const emberHead = bars(
  'r/8 C5 A4 F4 Ab4 A4 C5/q', 'D5/q. C5/8 Ab4/q F4', 'A4/8 C5 Eb5 D5 C5/q A4', 'G4/8 Bb4 D5 F5 Eb5/q D5/8 C5',
  'D5/h~ D5/8 C5 Bb4 Ab4', 'B4/q:70 D5:85 F5:100 Ab5:112', 'A5/q. F5/8 C5/q A4', 'G4/8 A4 C5 Eb5 F#5/q Eb5',
  'D5/8 F5 E5 D5 C5 Bb4 A4 G4', 'E4/q G4/8 Bb4 D5/q C5', 'A4/q F4 F#4/8 A4 C5 Eb5', 'D5/q Bb4/8 G4 E4/q C4',
);
const emberSolo = bars(
  'C5/8t D5 Eb5 F5/8 Eb5 C5 A4 F4/q', 'r/8 Ab4 Bb4 D5 F5/q Ab5/8 F5', 'G5/8t A5 G5 F5/8 Eb5 D5 C5 A4 F4',
  'G4/8 Bb4 Eb5 G5 F5/8t Eb5 C5 A4/q', 'Bb4/8 D5 F5 Ab5 G5/q F5', 'F5/8t D5 B4 Ab4 B4 D5 F5/q Ab5',
  'A5/h~ A5/8 G5 F5 Eb5', 'C5/8:80 Eb5:88 G5:96 Eb5:100 F#5:106 A5:112 C6:118 Eb6:124', 'D6/q. Bb5/8 G5/q D5',
  'E5/8t F5 E5 D5/8 C5 Bb4 G4 E4/q', 'F4/q A4/8 C5 F#5/q A5', 'G5/q F5/8 D5 E5/q C5',
);
const emberOut = emberHead.split(' | ').slice(0, 11).join(' | ') + ' | D5/q Bb4/8 G4 E5/q G5 | F5/w';
const emberBrass = bars(
  rests(12),
  'Eb4/w', 'D4/w', 'Eb4/w', 'Bb3/h A3', 'Ab3/w', 'Ab3/w', 'A3/w', 'G3/h F#3', 'F3/w', 'E3/w', 'Eb3/h C4', 'Bb3/h Bb3',
  rests(12),
  '(A3 D4)/w',
);

// ---------- 2. Sea Glass: a bossa nova ----------
const SEA = ['Dm9', 'Dm9', 'Em7b5', 'A7b9', 'Dm9', 'Dm9', 'Gm9', 'C9', 'Fmaj7', 'Bbmaj7', 'Em7b5', 'A7b9', 'Dm9', 'Bbmaj7', 'Em7b5 A7b9', 'Dm9'];
const seaTune = [
  'r/q A4/8 C5~ C5/q. A4/8', 'E5/h. r/8 F5', 'G5/q. F5/8 E5/q D5', 'C#5/h Bb4/q r/8 A4',
  'F5/q. E5/8~ E5/q D5', 'A4/h. r/8 C5', 'D5/q. Bb4/8~ Bb4/q A4', 'G4/h~ G4/8 Bb4 D5 E5',
  'F5/q. E5/8~ E5/h', 'D5/q. C5/8~ C5/q A4', 'Bb4/q. G4/8 E5/q D5', 'C#5/q. E5/8 G5/q Bb5',
  'A5/h~ A5/8 G5 F5 E5', 'D5/q. F5/8~ F5/q E5', 'D5/q Bb4 C#5 E5',
];
const seaFlute = bars(...seaTune, 'D5/w', ...seaTune, 'D5/w~', 'D5/w');
const seaStrings = bars(
  rests(16),
  'F4/w', 'E4/w', 'D4/w', 'C#4/w', 'C4/w', 'A3/w', 'Bb3/w', 'Bb3/w',
  'A3/w', 'A3/w', 'G3/w', 'G3/w', 'F3/w', 'F3/w', 'G3/h C#4', 'A3/w', '(D4 A4)/w',
);

// ---------- 3. Lantern Waltz: a jazz waltz ----------
const WALTZ = ['Fmaj7', 'Gm7 C7', 'Am7', 'Ab7', 'Gm7', 'C7', 'Fmaj7', 'D7b9', 'Gm7', 'Bbm6', 'Am7', 'D7', 'Gm7', 'C7sus4 C7', 'F6', 'C7'];
const lantern = bars(
  'A4/q C5 E5', 'D5/h E5/q', 'G5/h~ G5/8 E5', 'Eb5/q. C5/8 Ab4/q',
  'Bb4/8t C5 D5 F5/q E5', 'E5/h D5/q', 'C5/h.', 'F#5/q Eb5 C5',
  'D5/q. Bb4/8 G4/q', 'F4/8t G4 Bb4 Db5/q F5', 'E5/h~ E5/8 C5', 'A4/q F#4 D5',
  'Bb4/q D5 F5', 'F5/h E5/q', 'D5/q C5 A4', 'G4/q Bb4 E5',
);
const lanternPiano = bars(lantern, lantern, 'F5/h.');
const lanternBell = bars(rests(16, 'r/h.'), octave(lantern, 1), 'F6/h.');

// ---------- 4. Afterglow: a cinematic ballad ----------
const GLOW = ['Cmaj7', 'Em7', 'Fmaj7', 'G7sus4 G7', 'Am7', 'Em7', 'Fmaj7', 'Dm7 G7', 'Em7', 'A7b9', 'Dm7', 'G7sus4 G7', 'Cmaj7/E', 'Fmaj7', 'Fm6', 'Cmaj7'];
const glowMelody = [
  ramp(bars('E5/q. D5/8 C5/q G4', 'B4/h~ B4/8 C5 D5 E5', 'A5/q. G5/8 E5/h', 'D5/h B4/q G4'), 52, 68),
  ramp(bars('C5/q. B4/8 A4/q E5', 'G5/h. F#5/8 G5', 'A5/q. G5/8 F5/q E5', 'F5/q D5 D5/8 E5 F5 G5'), 68, 88),
  ramp(bars('B5/h. A5/8 G5', 'G5/q. F5/8 E5/q C#5', 'D5/h~ D5/8 E5 F5 A5', 'C6/h B5'), 88, 116),
  ramp(bars('C6/q. B5/8 G5/h', 'A5/q. G5/8 E5/q C5', 'Ab5/h G5/q F5', 'E5/w'), 100, 58),
].join(' | ');
const glowStrings = ramp(bars(
  '(E3 G3 B3)/w', '(E3 G3 B3)/w', '(F3 A3 C4)/w', '(F3 G3 C4)/h (F3 G3 B3)', '(E3 A3 C4)/w', '(E3 G3 B3)/w',
  '(F3 A3 C4)/w', '(F3 A3 C4)/h (F3 G3 B3)', '(E3 G3 B3)/w', '(E3 G3 C#4)/w', '(F3 A3 C4)/w', '(F3 G3 C4)/h (F3 G3 B3)',
  '(E3 G3 B3)/w', '(F3 A3 C4)/w', '(F3 Ab3 C4)/w', '(E3 G3 B3)/w',
), 50, 80);
const glowBell = bars(
  rests(4), 'r/h E6/q:70 B5:60', rests(3), 'r/h B5/8:70 E6 G6 B6', 'r/h A5/8 C#6 E6 G6', rests(2),
  'r/h G5/8 B5 E6 G6', 'r/h A5/8 C6 E6 A6', 'r/h Ab5/8 C6 F6 Ab6', 'r/h G5/8:60 B5:55 E6:50 G6:45',
);

// ---------- 5. Neon Strut: funk ----------
const FUNK = ['E9', 'E9', 'E9', 'E9', 'A9', 'A9', 'E9', 'E9', 'B7#9', 'A9', 'E9', 'E9', 'E9', 'E9', 'A9 B7#9', 'E7#9'];
const riffE = 'E4/16 r E4 G4 r/8 B4/16 D5 r/16 E4 r/8 G4/16 A4 B4/8';
const riffA = 'A4/16 r A4 C#5 r/8 E5/16 G5 r/16 A4 r/8 C#5/16 D5 E5/8';
const riffB = 'B4/16 r B4 D#5 r/8 F#5/16 A5 r/16 B4 r/8 D5/16 C#5 B4/8';
const neonClav = bars(
  riffE, riffE, riffE, riffE, riffA, riffA, riffE, riffE, riffB, riffA, riffE, riffE, riffE, riffE,
  'A4/16 r A4 C#5 r/8 E5/16 G5 r/16 B4 r/8 D5/16 C#5 B4/8', '(E4 G#4 D5)/q r r/h',
);
const hits = 'r/h r/8 (G#4 D5)/16 (G#4 D5) r/8 (G#4 D5)/8';
const neonBrass = bars(
  rests(4),
  'r/8 C#5/16 E5 G5/8 E5 r/h', 'r/q r/8 B4/16 C#5 E5/8 C#5 A4/q', 'r/8 G#4/16 B4 D5/8 F#5~ F#5/h', hits,
  'F#5/8. D5/16 r/8 A4 D#5/q r', 'E5/8. C#5/16 r/8 G4 B4/q r', 'G#4/16 B4 D5 F#5 G5/8 G#5~ G#5/h', hits,
  'r/8 G#4/16 B4 D5/8 B4 r/h', 'r/q r/8 F#4/16 G#4 B4/8 G#4 E4/q', '(C#5 E5)/q. (C#5 E5)/8 (D#5 A5)/q. (D#5 A5)/8', '(G#4 D5 G5)/h. r/q',
);

export const SHOWCASE = [
  {
    id: 'blue-ember', title: 'Blue Ember', style: 'Jazz swing', by: 'Claude',
    blurb: 'A swing blues in F: a horn-like synth plays the head, takes a bebop chorus full of triplets, and a brass line answers underneath.',
    bpm: 168, ts: '4/4', band: band('swing', [...BLUES, ...BLUES, ...BLUES.slice(0, 11), 'Gm7 C7', 'F6'], 11, { comp: { volume: -9 }, bass: { volume: -6 }, drums: { volume: -9 } }),
    parts: [
      { name: 'Tenor lead', clef: 'treble', sound: 'synth', volume: 2, patch: TENOR, text: bars(emberHead, emberSolo, emberOut) },
      { name: 'Brass', clef: 'bass', sound: 'synth', volume: -5, patch: BRASS, text: emberBrass },
    ],
  },
  {
    id: 'sea-glass', title: 'Sea Glass', style: 'Bossa nova', by: 'Claude',
    blurb: 'A bossa nova in D minor: a breathy flute melody over nylon guitar, with strings joining for the second time through.',
    bpm: 132, ts: '4/4', band: band('bossa', [...SEA, ...SEA, 'Dm9'], 4, { comp: { volume: -7 }, bass: { volume: -6 }, drums: { volume: -9 } }),
    parts: [
      { name: 'Flute', clef: 'treble', sound: 'synth', volume: 0, patch: FLUTE, text: seaFlute },
      { name: 'Strings', clef: 'bass', sound: 'strings', volume: -7, text: seaStrings },
    ],
  },
  {
    id: 'lantern-waltz', title: 'Lantern Waltz', style: 'Jazz waltz', by: 'Claude',
    blurb: 'A jazz waltz in F on the grand piano; the second chorus adds a glass bell an octave above.',
    bpm: 156, ts: '3/4', band: band('waltz', [...WALTZ, ...WALTZ, 'Fmaj7'], 7, { comp: { volume: -13 }, bass: { volume: -7 }, drums: { volume: -10 } }),
    parts: [
      { name: 'Piano', clef: 'treble', sound: 'piano', volume: 5, text: lanternPiano },
      { name: 'Bell', clef: 'treble', sound: 'synth', volume: -4, patch: BELL, text: lanternBell },
    ],
  },
  {
    id: 'afterglow', title: 'Afterglow', style: 'Ballad', by: 'Claude',
    blurb: 'A slow, cinematic ballad: the piano melody swells to a high climax and settles, over a string pad and bell arpeggios.',
    bpm: 68, ts: '4/4', band: band('ballad', GLOW, 3, { comp: { volume: -17 }, bass: { volume: -9 }, drums: { volume: -15 } }),
    parts: [
      { name: 'Piano', clef: 'treble', sound: 'piano', volume: 6, text: glowMelody },
      { name: 'Strings', clef: 'bass', sound: 'strings', volume: -6, text: glowStrings },
      { name: 'Bell', clef: 'treble', sound: 'synth', volume: -6, patch: BELL, text: glowBell },
    ],
  },
  {
    id: 'neon-strut', title: 'Neon Strut', style: 'Funk', by: 'Claude',
    blurb: 'Funk in E: a wah clav riff locks in with the band, then synth brass trades phrases and stabs.',
    bpm: 102, ts: '4/4', band: band('funk', FUNK, 5, { comp: { volume: -16 }, bass: { volume: -9 }, drums: { volume: -13 } }),
    parts: [
      { name: 'Clav', clef: 'treble', sound: 'synth', volume: 4, patch: CLAV, text: neonClav },
      { name: 'Brass', clef: 'treble', sound: 'synth', volume: 0, patch: BRASS, text: neonBrass },
    ],
  },
];
