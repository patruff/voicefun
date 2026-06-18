# VoiceFun

VoiceFun is a no-build GitHub Pages app for collecting and organizing voice reference recordings for voice cloning experiments.

It defaults to `.wav` because Smart Recorder on Android exports WAV files. The app stores voice references in the browser with IndexedDB, lets you keep notes per voice, previews audio, and drafts clone-job JSON for a future backend or voice API.

## What works on GitHub Pages

- Add multiple named voice profiles.
- Upload phone-recorded `.wav` reference files.
- Record from the browser when microphone permission is available.
- Preview saved references locally.
- Export a voice-library manifest.
- Copy a clone-job JSON payload.

## Important limitation

GitHub Pages is static hosting. It cannot run a voice-cloning model by itself, store files on a server, or call private APIs safely. Use this as the front end and add a backend/API later for actual synthesis.

Only clone voices you own or have explicit permission to use.
