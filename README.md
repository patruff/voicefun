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
- Export a voice-board manifest.

## Important limitation

GitHub Pages is static hosting. It cannot run a voice-cloning model by itself, store files on a server, or call private APIs safely. The current play button uses the browser speech engine; the uploaded WAV is stored and tied to the slot so a future backend/API can replace that playback with real cloned-voice synthesis.

Only clone voices you own or have explicit permission to use.
