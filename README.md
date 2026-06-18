# VoiceFun

VoiceFun is a no-build GitHub Pages app for collecting and organizing up to 9 voice reference recordings for voice cloning experiments.

It defaults to `.wav` because Smart Recorder on Android exports WAV files. The app stores each reference clip in the browser with IndexedDB and ties it to a fixed 3 x 3 voice slot with a name and playback text.

## What works on GitHub Pages

- Use a 3 x 3 grid with 9 total voice slots.
- Name each voice.
- Write text directly above each voice's play button.
- Upload one phone-recorded `.wav` reference clip per slot.
- Preview saved reference clips locally.
- Play the text in a slot with browser text-to-speech.
- Generate a story transcript from an optional LLM endpoint, with voice 1 as narrator and voices 2-9 as characters.
- Require character dialogue to include every phrase from the "Must use phrases" box.
- Play the generated transcript line by line.
- Export a voice-board manifest.

## Important limitation

GitHub Pages is static hosting. It cannot run a voice-cloning model by itself, store files on a server, or call private APIs safely. The current play buttons use the browser speech engine; uploaded WAV files are stored and tied to their slots so a future backend/API can replace playback with real cloned-voice synthesis. For LLM story writing, point the LLM endpoint field at your own small API that accepts `{ prompt, voices, phrases }` and returns `{ "transcript": [{ "slot": 1, "text": "..." }] }`.

Only clone voices you own or have explicit permission to use.
