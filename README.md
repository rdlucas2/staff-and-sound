# Staff & Sound

Write music on a staff and hear it played back, in the browser, with no build step.

- **Engraving:** [VexFlow 5](https://github.com/vexflow/vexflow) draws the score as SVG, with beaming, accidentals and line wrapping handled automatically.
- **Parts:** add up to 8 parts, each with its own staff, clef and instrument. Bars line up across staves and all parts play together.
- **Sound:** [Tone.js](https://tonejs.github.io/) plays a sampled grand piano (Salamander), plus strings, organ, pluck and chiptune synths. Each part has volume, mute and solo; there's a master volume too.
- **Input:** on-screen piano, computer keyboard, a MIDI keyboard (Web MIDI API), or a text notation.
- **Export:** saves a Standard MIDI File (`.mid`) via [@tonejs/midi](https://github.com/Tonejs/Midi), one track per part.

## Run it

It's a static site, but it needs to be served over HTTP (ES modules and the piano samples are fetched relative to the page). Web MIDI also needs a secure context: `localhost` or HTTPS.

```sh
python3 -m http.server 8000
# or: npx serve .
```

Then open http://localhost:8000.

To host it, any static host works (GitHub Pages, S3 + CloudFront, Netlify). Serve over HTTPS so Web MIDI is available.

## Text notation

| Example | Meaning |
| --- | --- |
| `C#4/q` | C-sharp in octave 4, quarter note |
| `Bb3/8.` | B-flat 3, dotted eighth |
| `(C4 E4 G4)/h` | C major chord, half note |
| `r/16` | sixteenth rest |
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
js/audio.js         Tone.js instruments, per-part channels (volume/mute/solo), layered playback
js/midi.js          MIDI file export and Web MIDI input
js/zip.js           tiny store-only zip writer (used when .mid downloads are not allowed)
samples/salamander  piano samples (CC BY 3.0, see README.txt there)
```

## Credits

- Salamander Grand Piano V3 by Alexander Holm, [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/). Samples via [Tonejs/audio](https://github.com/Tonejs/audio).
- VexFlow, Tone.js and @tonejs/midi are MIT licensed.

## License

Code is MIT licensed (see `LICENSE`). The piano samples keep their own CC BY 3.0 license.
