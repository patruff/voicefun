const DB_NAME = "voicefun";
const DB_VERSION = 1;
const STORE = "voices";
const SLOT_COUNT = 9;
const DEFAULT_STORY_ENDPOINT = "/api/story";
const STORY_ENDPOINT_KEY = "voicefun-story-endpoint";

const board = document.querySelector("#voiceBoard");
const template = document.querySelector("#voiceSlotTemplate");
const exportJson = document.querySelector("#exportJson");
const mustUsePhrases = document.querySelector("#mustUsePhrases");
const llmEndpoint = document.querySelector("#llmEndpoint");
const tellStory = document.querySelector("#tellStory");
const playStory = document.querySelector("#playStory");
const stopStory = document.querySelector("#stopStory");
const storyStatus = document.querySelector("#storyStatus");
const storyTranscript = document.querySelector("#storyTranscript");

let db;
let slots = [];
let transcript = [];
let currentStoryIndex = 0;

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) {
        request.result.createObjectStore(STORE, { keyPath: "id" });
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function store(mode = "readonly") {
  return db.transaction(STORE, mode).objectStore(STORE);
}

function getVoice(id) {
  return new Promise((resolve, reject) => {
    const request = store().get(id);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function saveVoice(slot) {
  return new Promise((resolve, reject) => {
    const request = store("readwrite").put(slot);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function getAllVoices() {
  return new Promise((resolve, reject) => {
    const request = store().getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function bytesToSize(bytes) {
  if (!bytes) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function slotId(index) {
  return `slot-${index}`;
}

function defaultSlot(index) {
  return {
    id: slotId(index),
    index,
    name: "",
    text: "",
    fileName: "",
    blob: null,
    updatedAt: Date.now()
  };
}

function isWav(file) {
  return file.name.toLowerCase().endsWith(".wav") || file.type === "audio/wav" || file.type === "audio/x-wav";
}

function getSpeechVoice(index) {
  const voices = window.speechSynthesis.getVoices();
  return voices[index % voices.length] || null;
}

function displayName(slot) {
  if (slot?.name) return slot.name;
  if (slot?.index === 0) return "Narrator";
  return `Character ${slot.index}`;
}

async function persistField(index, updates) {
  slots[index] = {
    ...slots[index],
    ...updates,
    updatedAt: Date.now()
  };
  await saveVoice(slots[index]);
}

function stopSpeech() {
  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
  currentStoryIndex = 0;
  storyStatus.textContent = "Stopped";
}

function playSlot(index) {
  const slot = slots[index];
  const text = slot.text.trim();

  if (!("speechSynthesis" in window)) {
    window.alert("This browser does not support text playback.");
    return;
  }

  if (!text) {
    window.alert("Write some text in this voice slot first.");
    return;
  }

  stopSpeech();
  const utterance = new SpeechSynthesisUtterance(text);
  const voice = getSpeechVoice(index);
  if (voice) utterance.voice = voice;
  utterance.rate = 1;
  utterance.pitch = 1;
  window.speechSynthesis.speak(utterance);
}

function getPhrases() {
  return mustUsePhrases.value
    .split(/\n|,/)
    .map((phrase) => phrase.trim())
    .filter(Boolean);
}

function speakerForLine(line) {
  const slotIndex = Math.max(0, Math.min(SLOT_COUNT - 1, Number(line.slot) - 1 || 0));
  return {
    slotIndex,
    slotNumber: slotIndex + 1,
    name: displayName(slots[slotIndex])
  };
}

function renderTranscript(lines) {
  storyTranscript.textContent = "";

  for (const line of lines) {
    const speaker = speakerForLine(line);
    const item = document.createElement("li");
    const speakerName = document.createElement("strong");
    const text = document.createElement("span");
    item.dataset.slot = String(speaker.slotNumber);
    speakerName.textContent = speaker.name;
    text.textContent = line.text;
    item.append(speakerName, text);
    storyTranscript.append(item);
  }
}

function normalizeLine(line, fallbackIndex) {
  const slot = Number(line.slot || line.voice || line.voiceSlot || line.speakerSlot);
  const text = String(line.text || line.line || line.dialogue || "").trim();

  return {
    slot: Number.isInteger(slot) && slot >= 1 && slot <= SLOT_COUNT ? slot : (fallbackIndex % SLOT_COUNT) + 1,
    text
  };
}

function normalizeTranscript(value) {
  const rawLines = Array.isArray(value) ? value : value?.transcript || value?.lines || [];
  return rawLines
    .map(normalizeLine)
    .filter((line) => line.text)
    .map((line) => ({
      slot: line.slot === 1 ? 1 : Math.max(2, Math.min(SLOT_COUNT, line.slot)),
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

function buildStoryPrompt(phrases) {
  const voices = slots.map((slot) => ({
    slot: slot.index + 1,
    role: slot.index === 0 ? "narrator" : "character",
    name: displayName(slot),
    hasReference: Boolean(slot.blob)
  }));

  return [
    "Write a short, lively audio drama transcript as JSON only.",
    "Use voice slot 1 only for narrator lines.",
    "Use voice slots 2-9 for character dialogue.",
    "Every phrase must appear exactly as written in at least one character line, not in narrator-only text.",
    "Return this schema: {\"transcript\":[{\"slot\":1,\"text\":\"...\"},{\"slot\":2,\"text\":\"...\"}]}",
    `Voices: ${JSON.stringify(voices)}`,
    `Must use phrases: ${JSON.stringify(phrases)}`
  ].join("\n");
}

async function callStoryEndpoint(phrases) {
  const endpoint = llmEndpoint.value.trim();
  if (!endpoint) return null;

  localStorage.setItem(STORY_ENDPOINT_KEY, endpoint);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: buildStoryPrompt(phrases),
      voices: slots.map((slot) => ({
        slot: slot.index + 1,
        name: displayName(slot),
        role: slot.index === 0 ? "narrator" : "character",
        hasReference: Boolean(slot.blob),
        fileName: slot.fileName
      })),
      phrases
    })
  });

  if (!response.ok) {
    throw new Error(`LLM endpoint returned ${response.status}`);
  }

  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : JSON.parse(await response.text());
  const lines = normalizeTranscript(payload);
  const missing = missingPhrases(lines, phrases);

  if (missing.length) {
    throw new Error(`Story missed: ${missing.join(", ")}`);
  }

  return lines;
}

function localStory(phrases) {
  const characterSlots = Array.from({ length: SLOT_COUNT - 1 }, (_, index) => index + 2);
  const titleSeed = phrases[0] || "the hidden song";
  const lines = [
    {
      slot: 1,
      text: `Tonight, ${displayName(slots[0])} opened the curtain on a story about ${titleSeed}.`
    },
    {
      slot: 2,
      text: `${displayName(slots[1])} stepped forward and promised that everyone would get a turn.`
    }
  ];

  phrases.forEach((phrase, index) => {
    const slot = characterSlots[index % characterSlots.length];
    const speaker = displayName(slots[slot - 1]);
    lines.push({
      slot,
      text: `${speaker} said, "${phrase}," and the room changed direction.`
    });
    lines.push({
      slot: 1,
      text: `The narrator watched voice ${slot} carry that phrase into the next scene.`
    });
  });

  lines.push({
    slot: characterSlots[(phrases.length + 1) % characterSlots.length],
    text: "By the end, every voice had found a place in the same strange little adventure."
  });
  lines.push({
    slot: 1,
    text: "And that is where the story stopped, waiting for the next recording."
  });

  return lines;
}

async function makeStory() {
  const phrases = getPhrases();
  tellStory.disabled = true;
  stopSpeech();
  storyStatus.textContent = "Writing...";

  try {
    const llmLines = await callStoryEndpoint(phrases);
    transcript = llmLines || localStory(phrases);
    renderTranscript(transcript);
    storyStatus.textContent = llmLines ? "Transcript from LLM" : "Transcript ready";
  } catch (error) {
    transcript = localStory(phrases);
    renderTranscript(transcript);
    storyStatus.textContent = `Local transcript used: ${error.message}`;
  } finally {
    tellStory.disabled = false;
  }
}

function speakTranscriptLine() {
  if (!transcript.length || currentStoryIndex >= transcript.length) {
    currentStoryIndex = 0;
    storyStatus.textContent = "Finished";
    return;
  }

  const line = transcript[currentStoryIndex];
  const speaker = speakerForLine(line);
  const utterance = new SpeechSynthesisUtterance(line.text);
  const voice = getSpeechVoice(speaker.slotIndex);
  if (voice) utterance.voice = voice;
  utterance.rate = 1;
  utterance.pitch = 1;
  storyStatus.textContent = `Playing ${speaker.name}`;
  utterance.onend = () => {
    currentStoryIndex += 1;
    speakTranscriptLine();
  };
  window.speechSynthesis.speak(utterance);
}

function playTranscript() {
  if (!("speechSynthesis" in window)) {
    window.alert("This browser does not support story playback.");
    return;
  }

  if (!transcript.length) {
    window.alert("Tell a story first.");
    return;
  }

  stopSpeech();
  storyStatus.textContent = "Playing";
  speakTranscriptLine();
}

function renderSlot(slot) {
  const fragment = template.content.cloneNode(true);
  const article = fragment.querySelector(".voice-slot");
  const number = fragment.querySelector(".slot-number");
  const status = fragment.querySelector(".slot-status");
  const nameInput = fragment.querySelector(".voice-name");
  const textInput = fragment.querySelector(".voice-text");
  const fileInput = fragment.querySelector(".voice-file");
  const playButton = fragment.querySelector(".play-button");
  const audio = fragment.querySelector(".reference-audio");
  const meta = fragment.querySelector(".reference-meta");

  article.dataset.slot = String(slot.index + 1);
  number.textContent = slot.index === 0 ? "Voice 1 · Narrator" : `Voice ${slot.index + 1} · Character`;
  nameInput.value = slot.name;
  textInput.value = slot.text;
  status.textContent = slot.blob ? "Reference ready" : "Empty";

  if (slot.blob) {
    audio.src = URL.createObjectURL(slot.blob);
    audio.hidden = false;
    meta.textContent = `${slot.fileName} · ${bytesToSize(slot.blob.size)}`;
  } else {
    audio.hidden = true;
  }

  nameInput.addEventListener("change", () => {
    persistField(slot.index, { name: nameInput.value.trim() });
  });

  textInput.addEventListener("input", () => {
    persistField(slot.index, { text: textInput.value });
  });

  fileInput.addEventListener("change", async () => {
    const file = fileInput.files[0];
    if (!file) return;

    if (!isWav(file)) {
      meta.textContent = "Use a `.wav` reference clip for this slot.";
      fileInput.value = "";
      return;
    }

    await persistField(slot.index, {
      fileName: file.name,
      blob: file
    });

    status.textContent = "Reference ready";
    audio.src = URL.createObjectURL(file);
    audio.hidden = false;
    meta.textContent = `${file.name} · ${bytesToSize(file.size)}`;
  });

  playButton.addEventListener("click", () => playSlot(slot.index));

  return fragment;
}

async function renderBoard() {
  board.textContent = "";
  slots = [];

  for (let index = 0; index < SLOT_COUNT; index += 1) {
    const saved = await getVoice(slotId(index));
    const slot = {
      ...defaultSlot(index),
      ...saved,
      id: slotId(index),
      index
    };
    slots.push(slot);
    board.append(renderSlot(slot));
  }
}

exportJson.addEventListener("click", async () => {
  const voices = await getAllVoices();
  const manifest = voices
    .filter((voice) => voice.id.startsWith("slot-"))
    .sort((a, b) => a.index - b.index)
    .map(({ blob, ...voice }) => ({
      ...voice,
      hasReference: Boolean(blob),
      referenceSize: blob?.size || 0,
      referenceType: blob?.type || "audio/wav"
    }));

  const blob = new Blob([JSON.stringify({ app: "VoiceFun", maxVoices: SLOT_COUNT, voices: manifest }, null, 2)], {
    type: "application/json"
  });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "voicefun-board.json";
  link.click();
  URL.revokeObjectURL(link.href);
});

tellStory.addEventListener("click", makeStory);
playStory.addEventListener("click", playTranscript);
stopStory.addEventListener("click", stopSpeech);

if ("speechSynthesis" in window) {
  window.speechSynthesis.addEventListener?.("voiceschanged", () => {});
}

llmEndpoint.value = localStorage.getItem(STORY_ENDPOINT_KEY) || DEFAULT_STORY_ENDPOINT;

openDb()
  .then((database) => {
    db = database;
    return renderBoard();
  })
  .catch((error) => {
    document.body.innerHTML = `<main class="error-panel"><h1>VoiceFun</h1><p>Could not open local storage: ${error.message}</p></main>`;
  });
