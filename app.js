const DB_NAME = "voicefun";
const DB_VERSION = 1;
const STORE = "voices";
const SLOT_COUNT = 9;
const DEFAULT_STORY_ENDPOINT = "/api/story";
const DEFAULT_VOICEBOX_URL = "http://127.0.0.1:17493";
const DEFAULT_VOICEBOX_MODEL_SIZE = "0.6B";
const STORY_ENDPOINT_KEY = "voicefun-story-endpoint";
const VOICEBOX_URL_KEY = "voicefun-voicebox-url";
const VOICE_PRESETS = [
  {
    id: "aiden",
    name: "Aiden",
    referenceText: "Hi I’m Aiden and I live in Delaware. And my country that I live in is the United States of America and I love my brother Logan."
  },
  {
    id: "peppa",
    name: "Peppa",
    referenceText: "Oooh, maybe at this restaurant the food is pretend. Hmmm, very much tasty food actually."
  },
  {
    id: "logan",
    name: "Logan",
    referenceText: "Hi my name is Logan. I like hiding in closets and I live in closeton. It’s a big place where there’s a lot of closets and there’s monsters in the closets sometimes and they kill you."
  },
  {
    id: "uncle-pat",
    name: "Uncle Pat",
    referenceText: "I made this app, yeah, it's pretty good. Homeboy. Home skillet. Homie. Well, hope you like it. Uncle Kevin is really good, but Uncle Pat isn't bad."
  },
  {
    id: "grandpa-joe",
    name: "Grandpa Joe",
    referenceText: "Voice, you ain't clonin' my voice. You clone my voice then you're gonna have it all over the internet or something like that and then I'm gonna be locked up for child abuse or something."
  },
  {
    id: "bandit",
    name: "Bandit From Bluey",
    referenceText: "Once upon a time there were three bears: Daddy bear, Mommy bear, and baby bear. Mamma bear made some porridge and in a really clear voice said \"look everyone it's hot okay, wait til it's cooled down\" but no one was listening, baby bear was on a screen watching something"
  },
  {
    id: "gandalf",
    name: "Gandalf",
    referenceText: "It says one ring to rule them all, one ring to find them, one ring to bring them all, and in the darkness bind them"
  }
];

const board = document.querySelector("#voiceBoard");
const template = document.querySelector("#voiceSlotTemplate");
const exportJson = document.querySelector("#exportJson");
const mustUsePhrases = document.querySelector("#mustUsePhrases");
const llmEndpoint = document.querySelector("#llmEndpoint");
const voiceboxUrl = document.querySelector("#voiceboxUrl");
const tellStory = document.querySelector("#tellStory");
const playStory = document.querySelector("#playStory");
const stopStory = document.querySelector("#stopStory");
const storyStatus = document.querySelector("#storyStatus");
const storyTranscript = document.querySelector("#storyTranscript");
const storyProgress = document.querySelector("#storyProgress");
const storyProgressText = document.querySelector("#storyProgressText");
const storyAudio = document.querySelector("#storyAudio");

let db;
let slots = [];
let transcript = [];
let designatedStoryLines = [];
let currentStoryIndex = 0;
let currentVoiceboxAudio = null;
let storyAudioUrl = "";

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
    referenceText: "",
    fileName: "",
    blob: null,
    voiceboxProfileId: "",
    voiceboxProfileName: "",
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

function presetForSlot(slot) {
  return VOICE_PRESETS.find((preset) => (
    preset.name === slot.name &&
    preset.referenceText === slot.referenceText
  ));
}

async function persistField(index, updates) {
  slots[index] = {
    ...slots[index],
    ...updates,
    updatedAt: Date.now()
  };
  await saveVoice(slots[index]);
}

function voiceboxBaseUrl() {
  const value = voiceboxUrl.value.trim().replace(/\/$/, "") || DEFAULT_VOICEBOX_URL;
  localStorage.setItem(VOICEBOX_URL_KEY, value);
  return value;
}

async function voiceboxFetch(path, options = {}) {
  const response = await fetch(`${voiceboxBaseUrl()}${path}`, {
    ...options,
    headers: {
      "X-Voicebox-Client-Id": "voicefun",
      ...(options.headers || {})
    }
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Voicebox ${response.status}: ${detail || response.statusText}`);
  }

  return response;
}

function setSlotStatus(index, message) {
  const article = board.querySelector(`.voice-slot[data-slot="${index + 1}"]`);
  const status = article?.querySelector(".slot-status");
  if (status) status.textContent = message;
}

function voiceboxHelp(error) {
  if (error instanceof TypeError || error.message === "Failed to fetch") {
    return [
      error.message,
      "Make sure Voicebox is running on 127.0.0.1:17493.",
      "For GitHub Pages, launch Voicebox with VOICEBOX_CORS_ORIGINS=https://patruff.github.io."
    ].join(" ");
  }

  return error.message;
}

function stopSpeech() {
  if ("speechSynthesis" in window) {
    window.speechSynthesis.cancel();
  }
  if (currentVoiceboxAudio) {
    currentVoiceboxAudio.pause();
    currentVoiceboxAudio = null;
  }
  storyAudio.pause();
  currentStoryIndex = 0;
  storyStatus.textContent = "Stopped";
}

function clearStoryAudio() {
  storyAudio.pause();
  storyAudio.removeAttribute("src");
  storyAudio.load();
  if (storyAudioUrl) {
    URL.revokeObjectURL(storyAudioUrl);
    storyAudioUrl = "";
  }
}

function setStoryProgress(value, max, text) {
  storyProgress.max = Math.max(1, max);
  storyProgress.value = Math.max(0, Math.min(value, storyProgress.max));
  storyProgressText.textContent = text;
}

async function pollGeneration(id) {
  if (!id) return;

  for (let attempt = 0; attempt < 1800; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    const response = await voiceboxFetch(`/generate/${id}/status`);
    const payload = await readVoiceboxStatus(response);

    if (["completed", "failed", "cancelled"].includes(payload.status)) {
      if (payload.status !== "completed") {
        throw new Error(payload.error || `Voicebox generation ${payload.status}`);
      }
      return payload;
    }
  }

  throw new Error("Voicebox generation timed out");
}

async function readVoiceboxStatus(response) {
  const text = await response.text();
  const dataLine = text
    .trim()
    .split(/\n+/)
    .reverse()
    .find((line) => line.startsWith("data:"));

  if (dataLine) {
    return JSON.parse(dataLine.replace(/^data:\s*/, ""));
  }

  return JSON.parse(text);
}

async function resolveVoiceboxProfileId(slot) {
  if (slot.voiceboxProfileId) return slot.voiceboxProfileId;

  const profileName = slot.voiceboxProfileName || slot.name?.trim();
  if (!profileName) {
    throw new Error("No Voicebox profile is linked for this slot.");
  }

  const response = await voiceboxFetch("/profiles");
  const profiles = await response.json();
  const profile = profiles.find((item) => item.name?.toLowerCase() === profileName.toLowerCase());

  if (!profile?.id) {
    throw new Error(`Voicebox profile '${profileName}' was not found.`);
  }

  slot.voiceboxProfileId = profile.id;
  slot.voiceboxProfileName = profile.name || profileName;
  await saveVoice(slot);
  return profile.id;
}

async function generateVoiceboxAudioBlob(slot, text) {
  const profileId = await resolveVoiceboxProfileId(slot);

  const response = await voiceboxFetch("/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      text,
      profile_id: profileId,
      language: "en",
      engine: "qwen",
      model_size: DEFAULT_VOICEBOX_MODEL_SIZE
    })
  });
  const generation = await response.json();
  await pollGeneration(generation.id);
  const audioResponse = await voiceboxFetch(`/audio/${generation.id}`);
  return audioResponse.blob();
}

async function speakWithVoicebox(slot, text) {
  const blob = await generateVoiceboxAudioBlob(slot, text);
  await playAudioBlob(blob);
}

async function playAudioBlob(blob) {
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);

  if (currentVoiceboxAudio) {
    currentVoiceboxAudio.pause();
  }
  currentVoiceboxAudio = audio;

  await new Promise((resolve, reject) => {
    audio.addEventListener("ended", resolve, { once: true });
    audio.addEventListener("error", () => reject(new Error("Voicebox audio playback failed.")), { once: true });
    audio.play().catch(reject);
  });

  URL.revokeObjectURL(url);
  if (currentVoiceboxAudio === audio) {
    currentVoiceboxAudio = null;
  }
}

async function decodeAudioBlob(audioContext, blob) {
  const arrayBuffer = await blob.arrayBuffer();
  return audioContext.decodeAudioData(arrayBuffer);
}

async function resampleBuffer(buffer, sampleRate) {
  if (buffer.sampleRate === sampleRate) return buffer;

  const frameCount = Math.ceil(buffer.duration * sampleRate);
  const offline = new OfflineAudioContext(buffer.numberOfChannels, frameCount, sampleRate);
  const source = offline.createBufferSource();
  source.buffer = buffer;
  source.connect(offline.destination);
  source.start();
  return offline.startRendering();
}

function concatenateBuffers(buffers) {
  const sampleRate = buffers[0].sampleRate;
  const channelCount = Math.max(...buffers.map((buffer) => buffer.numberOfChannels));
  const totalLength = buffers.reduce((sum, buffer) => sum + buffer.length, 0);
  const output = new AudioBuffer({
    length: totalLength,
    numberOfChannels: channelCount,
    sampleRate
  });
  let offset = 0;

  for (const buffer of buffers) {
    for (let channel = 0; channel < channelCount; channel += 1) {
      const input = buffer.getChannelData(Math.min(channel, buffer.numberOfChannels - 1));
      output.copyToChannel(input, channel, offset);
    }
    offset += buffer.length;
  }

  return output;
}

function audioBufferToWav(buffer) {
  const channelCount = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const samples = buffer.length;
  const bytesPerSample = 2;
  const blockAlign = channelCount * bytesPerSample;
  const dataSize = samples * blockAlign;
  const arrayBuffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(arrayBuffer);
  let offset = 0;

  function writeString(value) {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset, value.charCodeAt(index));
      offset += 1;
    }
  }

  writeString("RIFF");
  view.setUint32(offset, 36 + dataSize, true); offset += 4;
  writeString("WAVE");
  writeString("fmt ");
  view.setUint32(offset, 16, true); offset += 4;
  view.setUint16(offset, 1, true); offset += 2;
  view.setUint16(offset, channelCount, true); offset += 2;
  view.setUint32(offset, sampleRate, true); offset += 4;
  view.setUint32(offset, sampleRate * blockAlign, true); offset += 4;
  view.setUint16(offset, blockAlign, true); offset += 2;
  view.setUint16(offset, 16, true); offset += 2;
  writeString("data");
  view.setUint32(offset, dataSize, true); offset += 4;

  const channels = Array.from({ length: channelCount }, (_, channel) => buffer.getChannelData(channel));
  for (let sample = 0; sample < samples; sample += 1) {
    for (let channel = 0; channel < channelCount; channel += 1) {
      const value = Math.max(-1, Math.min(1, channels[channel][sample]));
      view.setInt16(offset, value < 0 ? value * 0x8000 : value * 0x7fff, true);
      offset += 2;
    }
  }

  return new Blob([arrayBuffer], { type: "audio/wav" });
}

async function buildStoryAudio(lines) {
  if (!lines.length) return;

  clearStoryAudio();
  const audioContext = new AudioContext();
  const decodedBuffers = [];
  setStoryProgress(0, lines.length + 1, "Starting audio");

  try {
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const speaker = speakerForLine(line);
      const slot = slots[speaker.slotIndex];

      if (!hasVoiceboxProfile(slot)) {
        throw new Error(`${speaker.name} is not synced with Voicebox.`);
      }

      storyStatus.textContent = `Generating ${speaker.name}`;
      setStoryProgress(index, lines.length + 1, `${index + 1}/${lines.length}: ${speaker.name}`);
      const blob = await generateVoiceboxAudioBlob(slot, line.text);
      decodedBuffers.push(await decodeAudioBlob(audioContext, blob));
    }

    storyStatus.textContent = "Stitching audio";
    setStoryProgress(lines.length, lines.length + 1, "Stitching");
    const sampleRate = decodedBuffers[0].sampleRate;
    const normalizedBuffers = [];
    for (const buffer of decodedBuffers) {
      normalizedBuffers.push(await resampleBuffer(buffer, sampleRate));
    }
    const stitched = concatenateBuffers(normalizedBuffers);
    const wav = audioBufferToWav(stitched);
    storyAudioUrl = URL.createObjectURL(wav);
    storyAudio.src = storyAudioUrl;
    storyAudio.load();
    setStoryProgress(lines.length + 1, lines.length + 1, `Ready · ${bytesToSize(wav.size)}`);
    storyStatus.textContent = "Story audio ready";
  } finally {
    await audioContext.close();
  }
}

function hasVoiceboxProfile(slot) {
  const name = slot.name?.trim() || "";
  const defaultName = `Voice ${slot.index + 1}`;
  return Boolean(slot.voiceboxProfileId || slot.voiceboxProfileName || (name && name !== defaultName));
}

async function playSlot(index) {
  const slot = slots[index];
  const text = slot.text.trim();

  if (!text) {
    window.alert("Write some text in this voice slot first.");
    return;
  }

  if (hasVoiceboxProfile(slot)) {
    try {
      setSlotStatus(index, "Voicebox speaking");
      await speakWithVoicebox(slot, text);
      setSlotStatus(index, "Voicebox ready");
      return;
    } catch (error) {
      setSlotStatus(index, "Voicebox error");
      window.alert(voiceboxHelp(error));
      return;
    }
  }

  if ("speechSynthesis" in window) {
    stopSpeech();
    const utterance = new SpeechSynthesisUtterance(text);
    const voice = getSpeechVoice(index);
    if (voice) utterance.voice = voice;
    utterance.rate = 1;
    utterance.pitch = 1;
    window.speechSynthesis.speak(utterance);
    setSlotStatus(index, "Browser voice");
  } else {
    window.alert("Sync this slot with Voicebox before playback.");
  }
}

function getPhrases() {
  return mustUsePhrases.value
    .split(/\n|,/)
    .map((phrase) => phrase.trim())
    .filter(Boolean);
}

function getDesignatedLines() {
  return transcript
    .filter((line) => line.text && Number(line.slot) >= 1 && Number(line.slot) <= SLOT_COUNT)
    .map((line) => ({
      slot: Number(line.slot),
      speaker: displayName(slots[Number(line.slot) - 1]),
      text: line.text
    }));
}

function speakerForLine(line) {
  const slotIndex = Math.max(0, Math.min(SLOT_COUNT - 1, Number(line.slot) - 1 || 0));
  return {
    slotIndex,
    slotNumber: slotIndex + 1,
    name: displayName(slots[slotIndex])
  };
}

function availableStorySlots() {
  return slots
    .filter((slot) => slot.voiceboxProfileId || slot.voiceboxProfileName)
    .map((slot) => slot.index + 1);
}

function firstAvailableSlot(preferCharacter = false) {
  const available = availableStorySlots();
  const character = available.find((slotNumber) => slotNumber > 1);
  return preferCharacter ? character || available[0] || 1 : available[0] || 1;
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

function sanitizeTranscriptSlots(lines, designatedLines) {
  const available = new Set(availableStorySlots());
  if (!available.size) {
    throw new Error("No synced Voicebox voices are available for story audio.");
  }

  return lines.map((line) => {
    if (available.has(Number(line.slot))) return line;

    const isDesignatedLine = designatedLines.some((designated) => (
      Number(designated.slot) === Number(line.slot) &&
      designated.text.toLowerCase() === line.text.toLowerCase()
    ));

    if (isDesignatedLine) {
      const speaker = displayName(slots[Number(line.slot) - 1]);
      throw new Error(`${speaker} is used in a designated line but is not synced with Voicebox.`);
    }

    return {
      ...line,
      slot: firstAvailableSlot(Number(line.slot) > 1)
    };
  });
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

function buildStoryPrompt(phrases, designatedLines) {
  const voices = slots.map((slot) => ({
    slot: slot.index + 1,
    role: slot.index === 0 ? "narrator" : "character",
    name: displayName(slot),
    isSynced: Boolean(slot.voiceboxProfileId || slot.voiceboxProfileName)
  }));
  const availableSlots = voices.filter((voice) => voice.isSynced).map((voice) => voice.slot);

  return [
    "Write a very short comedy-show sketch as an audio drama transcript. Return JSON only.",
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
    "Every must-use phrase must appear exactly as written in at least one character line, not in narrator-only text.",
    "Every designated line must appear exactly as written at least once, spoken by its assigned slot.",
    "A designated line may be preceded or followed by extra funny text in nearby lines, but the designated line itself must remain exact.",
    "Keep each line concise enough for spoken playback, but make each line distinct.",
    "Use punctuation to imply delivery, surprise, panic, confidence, deadpan, or hesitation, but do not include stage directions or bracketed emotions.",
    "Before returning, silently check that the sketch is coherent and no two lines are redundant.",
    "Return this schema: {\"transcript\":[{\"slot\":1,\"text\":\"...\"},{\"slot\":2,\"text\":\"...\"}]}",
    `Available synced voice slots: ${JSON.stringify(availableSlots)}`,
    `Voices: ${JSON.stringify(voices)}`,
    `Must use phrases: ${JSON.stringify(phrases)}`,
    `Designated lines: ${JSON.stringify(designatedLines)}`
  ].join("\n");
}

async function callStoryEndpoint(phrases, designatedLines) {
  const endpoint = llmEndpoint.value.trim();
  if (!endpoint) return null;

  localStorage.setItem(STORY_ENDPOINT_KEY, endpoint);
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt: buildStoryPrompt(phrases, designatedLines),
      voices: slots.map((slot) => ({
        slot: slot.index + 1,
        name: displayName(slot),
        role: slot.index === 0 ? "narrator" : "character",
        isSynced: Boolean(slot.voiceboxProfileId || slot.voiceboxProfileName),
        fileName: slot.fileName
      })),
      phrases,
      designatedLines
    })
  });

  if (!response.ok) {
    throw new Error(`LLM endpoint returned ${response.status}`);
  }

  const contentType = response.headers.get("content-type") || "";
  const payload = contentType.includes("application/json") ? await response.json() : JSON.parse(await response.text());
  const lines = sanitizeTranscriptSlots(normalizeTranscript(payload), designatedLines);
  const missing = missingPhrases(lines, phrases);
  const missingLines = missingDesignatedLines(lines, designatedLines);

  if (missing.length) {
    throw new Error(`Story missed: ${missing.join(", ")}`);
  }
  if (missingLines.length) {
    throw new Error(`Story missed designated lines: ${missingLines.map((line) => line.text).join(", ")}`);
  }

  return lines;
}

function localStory(phrases, designatedLines = []) {
  const availableSlots = availableStorySlots();
  const narratorSlot = availableSlots.includes(1) ? 1 : firstAvailableSlot(false);
  const characterSlots = availableSlots.filter((slotNumber) => slotNumber > 1);
  const fallbackCharacterSlots = characterSlots.length ? characterSlots : [narratorSlot];
  const topic = phrases[0] || "the emergency talent show";
  const featured = designatedLines;
  const nextCharacterSlot = (offset) => fallbackCharacterSlots[offset % fallbackCharacterSlots.length];
  const narratorName = displayName(slots[narratorSlot - 1]);
  const lines = [
    {
      slot: narratorSlot,
      text: `${narratorName} opened the show by announcing a simple plan about ${topic}. It immediately became suspiciously complicated.`
    },
    {
      slot: nextCharacterSlot(0),
      text: "Okay, nobody panic. I have made a clipboard, so this is technically organized."
    },
    {
      slot: nextCharacterSlot(1),
      text: "That clipboard is a menu with the word 'science' written on it."
    }
  ];

  if (featured[0]) {
    lines.push({
      slot: nextCharacterSlot(2),
      text: "Wait. Everyone be quiet. I think our first witness is about to make this weirder."
    });
    lines.push({ slot: featured[0].slot, text: featured[0].text });
  }

  if (featured[1]) {
    lines.push({
      slot: narratorSlot,
      text: "That was not evidence, but it did make everyone stand farther from the clipboard."
    });
    lines.push({
      slot: nextCharacterSlot(3),
      text: "I would like to object, but I do not know what trial this is."
    });
    lines.push({ slot: featured[1].slot, text: featured[1].text });
  }

  phrases.slice(0, 3).forEach((phrase, index) => {
    lines.push({
      slot: nextCharacterSlot(index + 4),
      text: `Fine, new rule: whoever says "${phrase}" has to explain why it sounds like a password.`
    });
  });

  featured.slice(2).forEach((line, index) => {
    lines.push({
      slot: nextCharacterSlot(index + 6),
      text: "I can fix this. I just need everyone to ignore the next sentence completely."
    });
    lines.push({ slot: line.slot, text: line.text });
  });

  lines.push({
    slot: nextCharacterSlot(7),
    text: "Great. Somehow the plan has gotten worse, but the confidence has gone way up."
  });
  lines.push({
    slot: narratorSlot,
    text: `${narratorName} ended the sketch there, because one more idea would have required a permit.`
  });

  return lines;
}

async function makeStory() {
  const phrases = getPhrases();
  const designatedLines = designatedStoryLines.length ? designatedStoryLines : getDesignatedLines();
  tellStory.disabled = true;
  playStory.disabled = true;
  stopSpeech();
  clearStoryAudio();
  setStoryProgress(0, 1, "Writing");
  storyStatus.textContent = "Writing...";

  if (!availableStorySlots().length) {
    storyStatus.textContent = "No synced voices";
    setStoryProgress(0, 1, "Sync voices first");
    tellStory.disabled = false;
    playStory.disabled = false;
    window.alert("Sync at least one voice with Voicebox before creating story audio.");
    return;
  }

  try {
    const llmLines = await callStoryEndpoint(phrases, designatedLines);
    transcript = llmLines || sanitizeTranscriptSlots(localStory(phrases, designatedLines), designatedLines);
    renderTranscript(transcript);
    storyStatus.textContent = llmLines ? "Transcript from LLM" : "Transcript ready";
  } catch (error) {
    try {
      transcript = sanitizeTranscriptSlots(localStory(phrases, designatedLines), designatedLines);
      renderTranscript(transcript);
      storyStatus.textContent = `Local transcript used: ${error.message}`;
    } catch (fallbackError) {
      storyStatus.textContent = "Story setup error";
      setStoryProgress(0, 1, "Setup failed");
      tellStory.disabled = false;
      playStory.disabled = false;
      window.alert(fallbackError.message);
      return;
    }
  }

  try {
    await buildStoryAudio(transcript);
  } catch (error) {
    storyStatus.textContent = "Audio build error";
    setStoryProgress(0, 1, "Audio failed");
    window.alert(voiceboxHelp(error));
  } finally {
    tellStory.disabled = false;
    playStory.disabled = false;
  }
}

async function speakTranscriptLine() {
  if (!transcript.length || currentStoryIndex >= transcript.length) {
    currentStoryIndex = 0;
    storyStatus.textContent = "Finished";
    return;
  }

  const line = transcript[currentStoryIndex];
  const speaker = speakerForLine(line);
  storyStatus.textContent = `Playing ${speaker.name}`;

  if (hasVoiceboxProfile(slots[speaker.slotIndex])) {
    try {
      await speakWithVoicebox(slots[speaker.slotIndex], line.text);
    } catch (error) {
      storyStatus.textContent = "Voicebox error";
      window.alert(voiceboxHelp(error));
      return;
    }
    currentStoryIndex += 1;
    speakTranscriptLine();
    return;
  }

  if ("speechSynthesis" in window) {
    const utterance = new SpeechSynthesisUtterance(line.text);
    const voice = getSpeechVoice(speaker.slotIndex);
    if (voice) utterance.voice = voice;
    utterance.rate = 1;
    utterance.pitch = 1;
    utterance.onend = () => {
      currentStoryIndex += 1;
      speakTranscriptLine();
    };
    window.speechSynthesis.speak(utterance);
  }
}

function playTranscript() {
  if (storyAudio.src) {
    stopSpeech();
    storyStatus.textContent = "Playing story audio";
    storyAudio.currentTime = 0;
    storyAudio.play();
    return;
  }

  if (!transcript.length) {
    window.alert("Create a story first.");
    return;
  }

  tellStory.disabled = true;
  playStory.disabled = true;
  buildStoryAudio(transcript)
    .then(() => {
      storyAudio.currentTime = 0;
      return storyAudio.play();
    })
    .catch((error) => {
      storyStatus.textContent = "Audio build error";
      window.alert(voiceboxHelp(error));
    })
    .finally(() => {
      tellStory.disabled = false;
      playStory.disabled = false;
    });
}

async function addTextToStory(index) {
  const slot = slots[index];
  const text = slot.text.trim();

  if (!text) {
    window.alert("Write text in this voice slot first.");
    return;
  }

  transcript.push({
    slot: index + 1,
    text
  });
  designatedStoryLines.push({
    slot: index + 1,
    speaker: displayName(slot),
    text
  });
  renderTranscript(transcript);
  storyStatus.textContent = "Line added";
}

async function syncVoiceboxProfile(index) {
  const slot = slots[index];
  const name = (slot.name || `VoiceFun ${index + 1}`).trim();

  if (!slot.blob) {
    window.alert("Upload a WAV reference clip first.");
    return;
  }

  if (!slot.referenceText.trim()) {
    window.alert("Add the exact reference transcript for the WAV before syncing Voicebox.");
    return;
  }

  setSlotStatus(index, "Syncing");

  try {
    const profilesResponse = await voiceboxFetch("/profiles");
    const profiles = await profilesResponse.json();
    const existing = profiles.find((profile) => profile.name?.toLowerCase() === name.toLowerCase());
    let profile = existing;

    if (!profile) {
      const createResponse = await voiceboxFetch("/profiles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          voice_type: "cloned",
          language: "en"
        })
      });
      profile = await createResponse.json();
    }

    const formData = new FormData();
    formData.append("file", slot.blob, slot.fileName || `${name}.wav`);
    formData.append("reference_text", slot.referenceText.trim());

    await voiceboxFetch(`/profiles/${profile.id}/samples`, {
      method: "POST",
      body: formData
    });

    await persistField(index, {
      voiceboxProfileId: profile.id,
      voiceboxProfileName: profile.name || name,
      name
    });
    setSlotStatus(index, "Voicebox ready");
  } catch (error) {
    setSlotStatus(index, "Voicebox error");
    window.alert(voiceboxHelp(error));
  }
}

async function transcribeReference(index) {
  const slot = slots[index];

  if (!slot.blob) {
    window.alert("Upload a WAV reference clip first.");
    return;
  }

  setSlotStatus(index, "Transcribing");

  try {
    const formData = new FormData();
    formData.append("file", slot.blob, slot.fileName || `voice-${index + 1}.wav`);
    formData.append("language", "en");

    const response = await voiceboxFetch("/transcribe", {
      method: "POST",
      body: formData
    });
    const payload = await response.json();
    await persistField(index, { referenceText: payload.text || "" });

    const article = board.querySelector(`.voice-slot[data-slot="${index + 1}"]`);
    const input = article?.querySelector(".reference-text");
    if (input) input.value = payload.text || "";

    setSlotStatus(index, "Transcript ready");
  } catch (error) {
    setSlotStatus(index, "Voicebox error");
    window.alert(voiceboxHelp(error));
  }
}

function renderSlot(slot) {
  const fragment = template.content.cloneNode(true);
  const article = fragment.querySelector(".voice-slot");
  const number = fragment.querySelector(".slot-number");
  const status = fragment.querySelector(".slot-status");
  const nameInput = fragment.querySelector(".voice-name");
  const presetSelect = fragment.querySelector(".voice-preset");
  const textInput = fragment.querySelector(".voice-text");
  const referenceText = fragment.querySelector(".reference-text");
  const fileInput = fragment.querySelector(".voice-file");
  const playButton = fragment.querySelector(".play-button");
  const addStoryButton = fragment.querySelector(".add-story-button");
  const transcribeButton = fragment.querySelector(".transcribe-button");
  const syncButton = fragment.querySelector(".sync-button");
  const audio = fragment.querySelector(".reference-audio");
  const meta = fragment.querySelector(".reference-meta");

  article.dataset.slot = String(slot.index + 1);
  number.textContent = slot.index === 0 ? "Voice 1 · Narrator" : `Voice ${slot.index + 1} · Character`;
  nameInput.value = slot.name;
  for (const preset of VOICE_PRESETS) {
    const option = document.createElement("option");
    option.value = preset.id;
    option.textContent = preset.name;
    presetSelect.append(option);
  }
  presetSelect.value = presetForSlot(slot)?.id || "";
  textInput.value = slot.text;
  referenceText.value = slot.referenceText || "";
  status.textContent = hasVoiceboxProfile(slot) ? "Voicebox ready" : slot.blob ? "Reference ready" : "Empty";

  if (slot.blob) {
    audio.src = URL.createObjectURL(slot.blob);
    audio.hidden = false;
    meta.textContent = `${slot.fileName} · ${bytesToSize(slot.blob.size)}`;
  } else {
    audio.hidden = true;
  }

  nameInput.addEventListener("change", () => {
    presetSelect.value = "";
    persistField(slot.index, { name: nameInput.value.trim() });
  });

  presetSelect.addEventListener("change", async () => {
    const preset = VOICE_PRESETS.find((item) => item.id === presetSelect.value);
    if (!preset) return;

    nameInput.value = preset.name;
    referenceText.value = preset.referenceText;
    await persistField(slot.index, {
      name: preset.name,
      referenceText: preset.referenceText,
      voiceboxProfileId: "",
      voiceboxProfileName: ""
    });
    status.textContent = slot.blob ? "Reference ready" : "Preset ready";
  });

  textInput.addEventListener("input", () => {
    persistField(slot.index, { text: textInput.value });
  });

  referenceText.addEventListener("input", () => {
    presetSelect.value = "";
    persistField(slot.index, { referenceText: referenceText.value });
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
      blob: file,
      voiceboxProfileId: "",
      voiceboxProfileName: ""
    });

    status.textContent = "Reference ready";
    audio.src = URL.createObjectURL(file);
    audio.hidden = false;
    meta.textContent = `${file.name} · ${bytesToSize(file.size)}`;
  });

  playButton.addEventListener("click", () => playSlot(slot.index));
  addStoryButton.addEventListener("click", () => addTextToStory(slot.index));
  transcribeButton.addEventListener("click", () => transcribeReference(slot.index));
  syncButton.addEventListener("click", () => syncVoiceboxProfile(slot.index));

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
voiceboxUrl.value = localStorage.getItem(VOICEBOX_URL_KEY) || DEFAULT_VOICEBOX_URL;

openDb()
  .then((database) => {
    db = database;
    return renderBoard();
  })
  .catch((error) => {
    document.body.innerHTML = `<main class="error-panel"><h1>VoiceFun</h1><p>Could not open local storage: ${error.message}</p></main>`;
  });
