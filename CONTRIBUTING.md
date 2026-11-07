# Contributing to Staff & Sound

Thanks for helping out. This guide covers how to run the project, how the code is organized, and how changes get in. Claude Code sessions picking up issues should follow it too.

## Run it locally

Staff & Sound is a static site with no build step. Serve the folder over HTTP:

```sh
python3 -m http.server 8000
# or: npx serve .
```

Then open http://localhost:8000.

Opening `index.html` straight from disk (`file://`) won't work: ES modules, the piano samples and the example files are all fetched relative to the page. Web MIDI and the microphone also need a secure context, which `localhost` counts as. Anywhere else, serve over HTTPS.

## How the code is organized

```
index.html          page shell; loads VexFlow, Tone.js and @tonejs/midi from jsDelivr
play.html           freeplay page: keyboard, synth editor, drum pads (no score)
css/styles.css      all styles, as theme tokens with light and dark values
js/main.js          UI state and wiring: parts, editing, chord editor, band panel, import/export, playback
js/notation.js      note model, text notation parser/serializer, bar splitting, timing and swing
js/score.js         VexFlow rendering: stacked staves, aligned bars, ties, chord lane
js/chords.js        chord symbol parser, chord chart parsing, spelling notes by chord degree
js/band.js          backing band: styles, voicings, bass lines, drum patterns
js/plan.js          merges parts and band into timed tracks for playback and MIDI export
js/audio.js         Tone.js instruments (sampled piano, editable synth, drum kit...), channels, playback
js/synth.js         synth patch model, presets and editor control definitions (no audio, runs in Node)
js/synth-panel.js   synth editor UI, shared by both pages
js/keyboard.js      playable on-screen keyboard widget
js/sampler.js       sampler data: recording, decoding, trimming, IndexedDB storage
js/sampler-panel.js sampler editor UI, shared by both pages
js/play.js          freeplay page (play.html)
js/midi.js          MIDI file export and Web MIDI keyboard input
js/midi-import.js   MIDI file to parts (quantizing, chords, ties across bar lines)
js/zip.js           minimal zip writer (used where .mid downloads aren't allowed)
demos/              example MIDI files and examples.json (generated)
scripts/            build-demos.js, which regenerates demos/ from text notation
samples/salamander  piano samples (CC BY 3.0)
```

The modules that do no DOM or audio work (`notation.js`, `chords.js`, `band.js`, `midi-import.js`, `synth.js`) run in Node as well as the browser. Keep them that way so they stay easy to test.

## Conventions

- **Plain ES modules, no bundler, no framework.** Libraries load as UMD globals (`window.VexFlow`, `window.Tone`, `window.Midi`) from jsDelivr, pinned to an exact version.
- **No new external hosts.** The page also runs inside the claude.ai artifact viewer, which only allows scripts from a few CDNs and blocks other network requests. Ship assets with the repo.
- **Degrade gracefully in restricted viewers.** The artifact viewer blocks the microphone, `<a download>` links and `alert`/`confirm`/`prompt`. Check for a feature and offer an alternative. For example, `saveMidi` in `js/midi.js` uses the viewer's download API when it's there.
- **Theme tokens for every color.** Define new colors in the `:root` block of `css/styles.css` and give them dark values in both dark-theme blocks. The score itself stays on light "paper" in both themes.
- **Layout must work at phone width** (about 400px) with no horizontal page scroll.
- **Write UI text plainly**, from the user's side: say what a control does ("Write band to staff"), and make errors say how to fix the problem.
- **Keep user data safe.** Anything that replaces the user's work should call `setUndo()` first so Undo can restore it. Persist with the draft in `localStorage` (wrapped in try/catch). For larger data (audio), use IndexedDB.

## Workflow

1. Pick an issue and add the **in progress** label so other people (and Claude sessions) know it's taken.
2. Branch off `main`: `feature/<short-name>` or `fix/<short-name>`.
3. Keep one feature per pull request. Small related changes can share one; say so in the description.
4. Reference the issue in the PR body (`Closes #12`) and describe what you tested.
5. Update the README when behavior changes, and this file when conventions change.

## Testing

There's no test framework yet; check your change directly.

- **Pure modules:** run them in Node, e.g. `node -e "import('./js/chords.js').then(m => console.log(m.parseChord('Dm7b5')))"`.
- **The page:** use Playwright with headless Chromium. Load the page, use the feature, check for page errors, and take screenshots at desktop width and around 400px, in light and dark themes. Chromium needs `--autoplay-policy=no-user-gesture-required` to start audio without a click.
- **Microphone:** launch Chromium with `--use-fake-ui-for-media-stream --use-fake-device-for-media-stream` and grant the `microphone` permission to get a fake mic that beeps.
- **Audio:** you can't listen in headless mode, but you can measure. New synth presets should land within a few dB of the piano when playing a three-note chord. Connect a `Tone.Meter` to `Tone.getDestination()` and compare levels when adding or changing instruments.
- **Clicking the score:** VexFlow sets `pointer-events="none"` on its SVG, and `css/styles.css` turns it back on. Keep that rule when changing the score styles.

## Demos

The example pieces live in `scripts/build-demos.js` as text notation. To change or add one:

```sh
npm install
npm run demos
```

This rewrites `demos/*.mid` and `demos/examples.json`. Commit the generated files.

## Licensing

- Code: MIT (see `LICENSE`).
- Piano samples: Salamander Grand Piano by Alexander Holm, CC BY 3.0. Keep the credit in the page footer and the README.
- Music added to the repo must be public domain or original. Don't add copyrighted songs or their melodies.
