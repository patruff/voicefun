const MODEL = process.env.OPENAI_STORY_MODEL || "gpt-5.4";
const API_URL = "https://api.openai.com/v1/responses";

function normalizePhrases(input) {
  if (Array.isArray(input)) return input.map(String).map((phrase) => phrase.trim()).filter(Boolean);
  return String(input || "")
    .split(/\n|,/)
    .map((phrase) => phrase.trim())
    .filter(Boolean);
}

function normalizeVoices(input) {
  const voices = Array.isArray(input) ? input : [];
  return Array.from({ length: 9 }, (_, index) => {
    const provided = voices.find((voice) => Number(voice.slot) === index + 1) || {};
    return {
      slot: index + 1,
      name: provided.name || (index === 0 ? "Narrator" : `Character ${index + 1}`),
      role: index === 0 ? "narrator" : "character",
      hasReference: Boolean(provided.hasReference),
      isSynced: Boolean(provided.isSynced),
      fileName: provided.fileName || ""
    };
  });
}

function normalizeDesignatedLines(input) {
  const lines = Array.isArray(input) ? input : [];
  return lines
    .map((line) => {
      const slot = Number(line.slot || line.voice || line.voiceSlot || line.speakerSlot);
      return {
        slot: Number.isInteger(slot) && slot >= 1 && slot <= 9 ? slot : 2,
        speaker: String(line.speaker || line.name || "").trim(),
        text: String(line.text || line.line || line.dialogue || "").trim()
      };
    })
    .filter((line) => line.text);
}

function storyPrompt({ phrases, voices, designatedLines }) {
  const availableSlots = voices.filter((voice) => voice.isSynced).map((voice) => voice.slot);

  return [
    "Write a very short comedy-show sketch as an audio-drama transcript.",
    "The sketch must have one clear comic premise, a setup, escalating confusion, a callback, and a final punchline.",
    "Keep it tight: 10 to 16 total lines when possible.",
    "If required phrases or designated lines make 16 lines impossible, use the shortest coherent sketch that includes every required item.",
    "Make the humor specific, conversational, and surprising. Prioritize real comic timing over plot mechanics.",
    "Use natural spoken dialogue with interruptions, misunderstandings, quick reactions, and emotional punctuation.",
    "The chosen designated lines are raw ingredients, not the whole story.",
    "Add your own funny lines before and after the designated lines so they land naturally as punchlines, reveals, or turns.",
    "Spread designated lines through the sketch. Do not place them back-to-back unless that creates a clear joke.",
    "Use only synced available voices. Do not invent or use any slot that is not listed as available.",
    "Use only characters that help the sketch. Do not force every available voice to speak.",
    "Do not repeat the same joke, phrase structure, character reaction, or narrator setup.",
    "Do not have multiple characters say basically the same thing.",
    "Do not write a list of disconnected one-liners.",
    "Do not pad with generic adventure, mystery, quest, meeting, prophecy, or random-object filler.",
    "Use voice slot 1 as narrator only if slot 1 is available.",
    "Use synced character slots for dialogue.",
    "Every required phrase must appear exactly as written in at least one character dialogue line, never only in narration.",
    "Every designated line must appear exactly as written at least once, spoken by its assigned slot.",
    "A designated line may be preceded or followed by extra funny text in nearby lines, but the designated line itself must remain exact.",
    "Keep each line concise enough for spoken playback, but make each line distinct.",
    "Use punctuation to imply delivery, surprise, panic, confidence, deadpan, or hesitation, but do not include stage directions or bracketed emotions.",
    "Before returning, silently check that the sketch is coherent and no two lines are redundant.",
    "Return JSON only with this exact shape:",
    "{\"transcript\":[{\"slot\":1,\"text\":\"...\"},{\"slot\":2,\"text\":\"...\"}]}",
    `Available synced voice slots: ${JSON.stringify(availableSlots)}`,
    `Voices: ${JSON.stringify(voices)}`,
    `Required phrases: ${JSON.stringify(phrases)}`,
    `Designated lines: ${JSON.stringify(designatedLines)}`
  ].join("\n");
}

function unsupportedSlots(lines, voices) {
  const available = new Set(voices.filter((voice) => voice.isSynced).map((voice) => voice.slot));
  return [...new Set(lines.map((line) => line.slot).filter((slot) => !available.has(slot)))];
}

function extractOutputText(payload) {
  if (payload.output_text) return payload.output_text;

  const chunks = [];
  for (const item of payload.output || []) {
    for (const content of item.content || []) {
      if (content.type === "output_text" && content.text) chunks.push(content.text);
      if (content.type === "text" && content.text) chunks.push(content.text);
    }
  }
  return chunks.join("\n");
}

function normalizeTranscript(value) {
  const rawLines = Array.isArray(value) ? value : value?.transcript || value?.lines || [];
  return rawLines
    .map((line, index) => {
      const slot = Number(line.slot || line.voice || line.voiceSlot || line.speakerSlot);
      return {
        slot: Number.isInteger(slot) && slot >= 1 && slot <= 9 ? slot : (index % 9) + 1,
        text: String(line.text || line.line || line.dialogue || "").trim()
      };
    })
    .filter((line) => line.text)
    .map((line) => ({
      slot: line.slot === 1 ? 1 : Math.max(2, Math.min(9, line.slot)),
      text: line.text
    }));
}

function missingPhrases(lines, phrases) {
  const characterText = lines
    .filter((line) => Number(line.slot) > 1)
    .map((line) => line.text.toLowerCase())
    .join("\n");

  return phrases.filter((phrase) => !characterText.includes(phrase.toLowerCase()));
}

function missingDesignatedLines(lines, designatedLines) {
  const storyText = lines
    .map((line) => `${line.slot}: ${line.text}`)
    .join("\n")
    .toLowerCase();

  return designatedLines.filter((line) => !storyText.includes(line.text.toLowerCase()));
}

export async function generateStory({ phrases: phraseInput, voices: voiceInput, designatedLines: designatedInput }) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not set");
  }

  const phrases = normalizePhrases(phraseInput);
  const voices = normalizeVoices(voiceInput);
  const designatedLines = normalizeDesignatedLines(designatedInput);
  const response = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: MODEL,
      input: storyPrompt({ phrases, voices, designatedLines })
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI request failed with ${response.status}: ${errorText}`);
  }

  const payload = await response.json();
  const parsed = JSON.parse(extractOutputText(payload));
  const transcript = normalizeTranscript(parsed);
  const unsupported = unsupportedSlots(transcript, voices);
  const missing = missingPhrases(transcript, phrases);
  const missingLines = missingDesignatedLines(transcript, designatedLines);

  if (unsupported.length) {
    throw new Error(`OpenAI transcript used unsynced voice slots: ${unsupported.join(", ")}`);
  }
  if (missing.length) {
    throw new Error(`OpenAI transcript missed required phrases: ${missing.join(", ")}`);
  }
  if (missingLines.length) {
    throw new Error(`OpenAI transcript missed designated lines: ${missingLines.map((line) => line.text).join(", ")}`);
  }

  return {
    model: MODEL,
    transcript
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const input = JSON.parse(process.argv[2] || "{}");
  generateStory(input)
    .then((story) => {
      process.stdout.write(`${JSON.stringify(story, null, 2)}\n`);
    })
    .catch((error) => {
      process.stderr.write(`${error.stack || error.message}\n`);
      process.exitCode = 1;
    });
}
