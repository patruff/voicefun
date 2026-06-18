const DB_NAME = "voicefun";
const DB_VERSION = 1;
const STORE = "voices";
const SLOT_COUNT = 9;

const board = document.querySelector("#voiceBoard");
const template = document.querySelector("#voiceSlotTemplate");
const exportJson = document.querySelector("#exportJson");

let db;
let slots = [];

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
  number.textContent = `Voice ${slot.index + 1}`;
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

if ("speechSynthesis" in window) {
  window.speechSynthesis.addEventListener?.("voiceschanged", () => {});
}

openDb()
  .then((database) => {
    db = database;
    return renderBoard();
  })
  .catch((error) => {
    document.body.innerHTML = `<main class="error-panel"><h1>VoiceFun</h1><p>Could not open local storage: ${error.message}</p></main>`;
  });
