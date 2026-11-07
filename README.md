# Staff & Sound

Write music on a staff and hear it played back, in the browser, with no build step.

- **Engraving:** [VexFlow 5](https://github.com/vexflow/vexflow) draws the score as SVG, with beaming, accidentals and line wrapping handled automatically.
- **Chords & band:** write chord symbols over the bars (click above a bar, or type a whole chart) and a backing band plays them: comping, bass and drums in jazz swing, bossa nova, jazz waltz, ballad, pop/rock or funk. A small, browser-only take on the Band-in-a-Box idea.
- **Parts:** add up to 8 parts, each with its own staff, clef and instrument. Bars line up across staves and all parts play together.
- **Sound:** [Tone.js](https://tonejs.github.io/) plays a sampled grand piano (Salamander), plus strings, organ, pluck and chiptune synths. Each part has volume, mute and solo; there's a master volume too.
- **Synth:** any part can use an editable synth, with two oscillators (unison spread, pulse width), amp and filter envelopes, resonant filter, vibrato and tremolo, mono with glide, chorus, delay and reverb. Comes with presets such as Synth Brass, Strings, Square Lead, Glass Bell, Synth Bass, Warm Pad, 8-bit Lead and Wah Clav.
- **Sampler:** record a sound with the microphone (or load an audio file) and play it across the keyboard, Casio SK-1 style, with auto-trim, root note, loop, reverse, attack and release.
- **Freeplay:** `play.html` is just the instrument: a big multi-touch keyboard, computer-keyboard and MIDI input with velocity and sustain pedal, octave and transpose, drum pads, the synth editor and the sampler, plus a backing band to jam over (your own chord charts, saved as backing tracks).
- **Record:** play freely (MIDI keyboard, computer keys or on-screen keys) with a click and count-in, optionally over your other parts and the band, and the take is written as notation. Adjust quantize (straight or triplet grids, swing feel, shortest note, legato, chord window) and watch the staff update before keeping it.
- **Input:** on-screen piano, computer keyboard, a MIDI keyboard (Web MIDI API), or a text notation.
- **Import:** open any `.mid` file (picker or drag-and-drop) or one of the bundled examples. Each track becomes a part; rhythms snap to sixteenths, notes crossing a bar line are tied, and two-hand piano tracks split onto two staves. Undo restores what you had.
- **Export:** saves a Standard MIDI File (`.mid`) via [@tonejs/midi](https://github.com/Tonejs/Midi): one track per part, the band's comping and bass, and drums on General MIDI channel 10.

## Run it

It's a static site, but it needs to be served over HTTP (ES modules and the piano samples are fetched relative to the page). Web MIDI also needs a secure context: `localhost` or HTTPS.

```sh
python3 -m http.server 8000
# or: npx serve .
```

Then open http://localhost:8000.

To host it, any static host works (GitHub Pages, S3 + CloudFront, Netlify). Serve over HTTPS so Web MIDI is available.

## Chords and the backing band

Click just above any bar on the score to type its chords (`Tab` moves to the next bar, `Enter` finishes), or write the whole chart in the **Chords & band** box:

```
Dm7 G7 | Cmaj7 | % | Dm7b5 / G7b9 / | Cm6 | N.C. |
```

| Example | Meaning |
| --- | --- |
| `|` or a new line | next bar |
| `Dm7 G7` | two chords share the bar evenly |
| `Dm7 / / G7` | one slot per beat: three beats of Dm7, one of G7 |
| `%` | repeat the previous bar |
| `/` | hold the previous chord through this bar |
| `N.C.` | no chord: comping and bass rest, drums keep going |

Chord symbols cover the usual forms: `C`, `Cm`, `C7`, `Cmaj7` (`CΔ`, `CM7`), `Cm7`, `C-7`, `Cm7b5` (`Cø`), `Cdim7` (`C°7`), `Caug`, `C6`, `C69`, `C9`, `C11`, `C13`, `C7b9`, `C7#9`, `C7#11`, `C7b13`, `C7alt`, `Csus4`, `C7sus4`, `Cadd9`, `CmMaj7`, `C5`, and slash chords like `F/A`. Anything unrecognized is underlined in red and the previous chord carries on.

**Styles** set the time signature, a suggested tempo and default instruments:

| Style | Comping | Bass | Drums | Feel |
| --- | --- | --- | --- | --- |
| Jazz swing | Charleston-style piano, rootless voicings, anticipations | walking quarter notes with chromatic approaches | ride, hi-hat on 2 and 4, ghost notes | swung |
| Bossa nova | nylon guitar, two-bar syncopated pattern | root and fifth | cross-stick bossa clave, shaker | straight |
| Jazz waltz | piano in 3/4 | walking in three | ride in three | swung |
| Ballad | sustained electric piano | half notes | soft hi-hat and cross-stick | straight |
| Pop / rock | piano pulse or push rhythms, triad voicings | driving eighths | backbeat, fills every 8 bars | straight |
| Funk | sixteenth-note electric-piano stabs | syncopated root, octave and seventh | sixteenth hats, ghost notes | straight |

Voicings move by the smallest steps from chord to chord. Variation is seeded: **New variation** gives the same chart different rhythms and voicings, and the same seed always plays back the same way. In swing styles every part, including what you wrote, plays with swung eighths.

**Write band to staff** turns the current comping and bass into editable parts (spelled by chord degree, so the 7th of C7 is B♭), and mutes their band versions so nothing doubles. The drums keep playing.

All band sounds are synthesized with Tone.js (no samples beyond the piano): a Karplus-Strong nylon guitar, an FM electric piano, upright and electric basses, and a synth drum kit.

## Synth and freeplay

Set a part's sound to **Synth (editable)** and its card gets an **Edit sound** button that opens the patch editor under the parts. The edited part becomes the active one, so the on-screen keys and your MIDI keyboard play through it while you adjust. Changes apply live, even while notes are sounding. Each part keeps its own patch, saved with the draft; MIDI export uses a matching General MIDI program (patches themselves can't travel in a MIDI file).

The **Freeplay keyboard** (`play.html`, linked from the top of the page) has no score:

| Input | Action |
| --- | --- |
| Mouse or touch | play; slide for a glissando; lower on the key is louder |
| `a w s e d f t g y h u j k o l p ; '` | keys from C (letters shown on the keyboard) |
| `z` / `x` | octave down / up |
| `Space` (hold) or MIDI sustain pedal | sustain |
| `1`–`8` | drum pads |
| `Esc` | all notes off |

**Backing track.** Freeplay has its own chord chart and band (same chart syntax, styles and presets as the score):

- **Play band** with tempo, loop (on by default) and a count-in. A large **Now / Next** display shows the current and upcoming chord and the bar, and the current chord's tones are marked on the keyboard (the root in a stronger color) so you know what fits. Turn that off with **Show chord tones**.
- Keep playing the keyboard, MIDI keyboard, sampler or synth over it; comping, bass and drums have their own sound, volume and mute.
- **My tracks:** name and save backing tracks (chart, style, tempo, variation and mix) in this browser, load them later, delete them (with undo).
- **Use the score's chords** loads the chart, style and tempo from the main page. **Open on the staff →** sends the current chart to the main page's score, where Undo puts the previous chords back.

Freeplay settings, the patch and saved tracks are remembered separately from the score.

## Sampler

Choose **Sampler (your sound)** for a part (then **Edit sample**), or use the Sampler section on the freeplay page:

1. **Record** asks for the microphone and records up to 5 seconds, with a level meter. Or **Load audio file…** (WAV, MP3, OGG and the like, up to 10 seconds).
2. Silence is trimmed and the level normalized automatically. Adjust **Start** and **End** on the waveform, or run **Auto-trim silence** again.
3. Set the **Root note** to the pitch you recorded (the key that plays it back unchanged); other keys play it faster or slower.
4. Shape it with **Attack**, **Release**, **Level**, **Loop while held** and **Reverse**.

There's one shared sample, kept in your browser's IndexedDB so it survives reloads. Until you record one, a built-in kalimba sound is used. The microphone needs HTTPS or localhost and isn't available inside some embedded viewers (including the claude.ai artifact viewer); loading a file works everywhere. MIDI export can't carry the sample, so sampler parts export as General MIDI program 54 (Synth Voice).

## Recording a performance

In **Record a performance** (under the keyboard):

1. Choose **Replace the part** or **Add after the end**, a count-in (none, 1 or 2 bars), the click and its volume, and whether your other parts and the band play along.
2. Press **Record** and play after the count-in, on a MIDI keyboard (velocity and sustain pedal work), your computer keys or the on-screen keys. Notes appear on the staff as you play. **Space** or **Stop** ends the take.
3. Shape the transcription while you watch the staff:

| Setting | What it does |
| --- | --- |
| Quantize to | grid: 1/4, 1/8, 1/16, 1/8 triplet or 1/16 triplet |
| Feel | for 1/8 and 1/16: read swung off-beats as straight eighths, as notation does |
| Shortest note | written notes are at least this long |
| Legato | stretch notes to the next note, closing small gaps |
| Chord window | notes struck this close together become one chord |
| Ignore shorter than | drop accidental taps |
| Keep velocities | store how hard each note was played |

4. **Keep it** saves the result; **Discard take** puts the part back. Undo also goes back to before the recording.

Timing uses the audio clock and subtracts the browser's reported output latency, so play along to what you hear. Tempo and time signature come from the score. Each part is still one line of notes or chords, so a note held under a moving melody is shortened when the next note starts.

## Starting over

**New** clears everything: one empty piano part, no chords, 4/4 at 108 bpm, band settings back to their defaults. **Load demo** brings back the opening Ode to Joy demo. Both can be undone with **Undo** in the status line. Your master volume is kept.

## Text notation

| Example | Meaning |
| --- | --- |
| `C#4/q` | C-sharp in octave 4, quarter note |
| `Bb3/8.` | B-flat 3, dotted eighth |
| `(C4 E4 G4)/h` | C major chord, half note |
| `r/16` | sixteenth rest |
| `C4/h~ C4/q` | tie: one C sounding for three beats |
| `E4/8t F4 G4` | eighth-note triplet (`t` after the duration) |
| `A4/q:100` | velocity 0–127 after a colon (recordings keep how hard you played) |
| `D4 E4 F4` | duration carries over from the previous note |
| `\|` | optional bar line (bars are computed from the time signature) |

Durations: `w` `h` `q` `8` `16` `32`. Accidentals: `#` `##` `b` `bb` `n`.

## Keyboard shortcuts

| Keys | Action |
| --- | --- |
| `a s d f g h j k` | white keys C to C |
| `w e t y u` | black keys |
| `1`–`5` | whole to sixteenth |
| `.` / `c` | toggle dot / chord mode |
| `-` | tie the selected (or last) note to the next |
| `r` / `Backspace` | add rest / delete |
| `z` / `x` | octave down / up |
| `←` `→` / `Esc` | move / clear selection |
| `↑` `↓` | previous / next part |
| `Space` | play / stop |

On a MIDI keyboard, notes pressed together (within ~70 ms) become a chord.

## Layout

```
index.html          page shell; loads VexFlow, Tone.js and @tonejs/midi from jsDelivr
css/styles.css      styles (light and dark themes)
js/main.js          UI state, editing, input handling, playback wiring
js/notation.js      note model, text parser/serializer, bar splitting, timing
js/score.js         VexFlow rendering: stacked staves per system, bars aligned across parts
js/audio.js         Tone.js instruments (incl. synth, drum kit, guitar, e-piano, basses), channels, playback
js/synth.js         synth patch model, presets, editor control definitions
js/synth-panel.js   the synth editor UI (used on both pages)
js/keyboard.js      playable on-screen keyboard (multi-touch, glissando, velocity)
js/sampler.js       sampler data: mic recording, file decoding, trimming, IndexedDB storage
js/sampler-panel.js the sampler editor UI (used on both pages)
js/play.js          the freeplay page
play.html           freeplay page shell
js/chords.js        chord symbol parser, chart parsing, chord-degree spelling
js/band.js          backing band: styles, voicings, walking/pattern bass, drum patterns
js/plan.js          merges parts and band into timed tracks for playback and export
js/midi.js          MIDI file export and Web MIDI input
js/midi-import.js   MIDI file -> parts; notesFromRaw writes timed notes as notation (straight and triplet grids, ties)
js/quantize.js      quantizing recorded performances (grids, swing, chord grouping, legato)
js/zip.js           tiny store-only zip writer (used when .mid downloads are not allowed)
samples/salamander  piano samples (CC BY 3.0, see README.txt there)
demos/              example MIDI files (public-domain pieces)
scripts/            build-demos.js regenerates demos/ from text notation
```

## Example pieces

`demos/` holds simple arrangements of public-domain music, generated from text notation by `scripts/build-demos.js`:

- **Minuet in G** (Christian Petzold, long attributed to J. S. Bach): right and left hand, 3/4
- **Canon in D** (Johann Pachelbel): three violins in canon over the ground bass
- **Twinkle, Twinkle, Little Star** (traditional): melody and bass

The script also writes `demos/examples.json` (the same files, base64-encoded), which is what the page loads, since some static hosts won't serve `.mid`. To change or add a piece, edit the script and run `npm install && npm run demos`.

## Band limits

- Six fixed styles; there's no style editor yet.
- No count-in, intro or ending variations beyond a final chord.
- MIDI export is timed as heard, so swung styles export swung eighths (re-importing quantizes them to sixteenths).

## Import limits

- Rhythms are snapped to a sixteenth-note grid, so triplets and swing come out approximate.
- Each part holds a single line of notes or chords; a note that overlaps the next one is shortened.
- Drum tracks are skipped, tempo changes are ignored, and imports stop at 8 parts and 64 bars.

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for how to run the project, how the code is organized, conventions and testing. Open work is tracked in [GitHub issues](https://github.com/rdlucas2/staff-and-sound/issues).

## Credits

- Salamander Grand Piano V3 by Alexander Holm, [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). Samples via [Tonejs/audio](https://github.com/Tonejs/audio).
- VexFlow, Tone.js and @tonejs/midi are MIT licensed.

## License

Code is MIT licensed (see `LICENSE`). The piano samples keep their own CC BY 3.0 license.
