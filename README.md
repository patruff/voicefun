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

## OpenAI story teller

The repo includes a server-side OpenAI story generator at `scripts/generate-story.mjs`. It uses `gpt-5.4-nano` by default and expects `OPENAI_API_KEY` to be set in the server environment.

There is also a Vercel-style serverless function at `api/story.js` that accepts:

```json
{
  "phrases": ["silver moon", "secret door"],
  "voices": [{ "slot": 1, "name": "Narrator", "hasReference": true }]
}
```

It returns:

```json
{
  "model": "gpt-5.4-nano",
  "transcript": [{ "slot": 1, "text": "..." }]
}
```

The GitHub Actions workflow `Generate story transcript` can use the repository `OPENAI_API_KEY` secret safely and upload a `story-transcript.json` artifact.

## Important limitation

GitHub Pages is static hosting. It cannot read GitHub secrets, run a voice-cloning model, store files on a server, or call private APIs safely. The current play buttons use the browser speech engine; uploaded WAV files are stored and tied to their slots so a future backend/API can replace playback with real cloned-voice synthesis. The page defaults to calling `/api/story`, but GitHub Pages will fall back to local transcript generation unless you deploy a serverless/backend host for that endpoint.

Only clone voices you own or have explicit permission to use.
