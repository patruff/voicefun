const DB_NAME = "voicefun";
const DB_VERSION = 1;
const STORE = "voices";

const form = document.querySelector("#voiceForm");
const voiceName = document.querySelector("#voiceName");
const voicePrompt = document.querySelector("#voicePrompt");
const voiceFile = document.querySelector("#voiceFile");
const recordButton = document.querySelector("#recordButton");
const recordStatus = document.querySelector("#recordStatus");
const clearForm = document.querySelector("#clearForm");
const voiceList = document.querySelector("#voiceList");
const voiceCount = document.querySelector("#voiceCount");
const cloneVoice = document.querySelector("#cloneVoice");
const cloneText = document.querySelector("#cloneText");
const copyJob = document.querySelector("#copyJob");
const jobPreview = document.querySelector("#jobPreview");
const exportJson = document.querySelector("#exportJson");
const template = document.querySelector("#voiceCardTemplate");

let db;
let audioContext;
let audioSource;
let audioProcessor;
let recordingStream;
let recordingBuffers = [];
let recordingLength = 0;
let isRecording = false;

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      request.result.createObjectStore(STORE, { keyPath: "id" });
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function transaction(mode = "readonly") {
  return db.transaction(STORE, mode).objectStore(STORE);
}

function getAllVoices() {
  return new Promise((resolve, reject) => {
    const request = transaction().getAll();
    request.onsuccess = () => resolve(request.result.sort((a, b) => b.createdAt - a.createdAt));
    request.onerror = () => reject(request.error);
  });
}

function saveVoice(voice) {
  return new Promise((resolve, reject) => {
    const request = transaction("readwrite").put(voice);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function deleteVoice(id) {
  return new Promise((resolve, reject) => {
    const request = transaction("readwrite").delete(id);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function bytesToSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function sanitizeFilename(name) {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "voice";
}

function renderJob() {
  const selected = cloneVoice.value;
  const payload = {
    voiceId: selected || null,
    inputFormat: "wav",
    text: cloneText.value.trim(),
    consent: "Use only voices you own or have explicit permission to clone."
  };

  jobPreview.textContent = JSON.stringify(payload, null, 2);
}

async function renderVoices() {
  const voices = await getAllVoices();
  voiceList.textContent = "";
  cloneVoice.textContent = "";
  voiceCount.textContent = String(voices.length);

  if (!voices.length) {
    const empty = document.createElement("p");
    empty.className = "voice-notes";
    empty.textContent = "No voices yet. Add a `.wav` reference to start building your library.";
    voiceList.append(empty);

    const option = new Option("No saved voices", "");
    cloneVoice.append(option);
    renderJob();
    return;
  }

  for (const voice of voices) {
    const card = template.content.cloneNode(true);
    const audioUrl = URL.createObjectURL(voice.blob);
    card.querySelector("h3").textContent = voice.name;
    card.querySelector(".voice-meta").textContent = `${voice.fileName} · ${bytesToSize(voice.blob.size)}`;
    card.querySelector(".voice-notes").textContent = voice.prompt || "No prompt notes yet.";
    card.querySelector("audio").src = audioUrl;
    card.querySelector(".delete-button").addEventListener("click", async () => {
      URL.revokeObjectURL(audioUrl);
      await deleteVoice(voice.id);
      await renderVoices();
    });
    voiceList.append(card);

    cloneVoice.append(new Option(voice.name, voice.id));
  }

  renderJob();
}

function blobToWavFile(blob, fallbackName) {
  const fileName = `${sanitizeFilename(fallbackName)}.wav`;
  return new File([blob], fileName, { type: "audio/wav" });
}

function encodeWav(buffers, sampleRate) {
  const samples = new Float32Array(recordingLength);
  let offset = 0;

  for (const buffer of buffers) {
    samples.set(buffer, offset);
    offset += buffer.length;
  }

  const dataSize = samples.length * 2;
  const arrayBuffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(arrayBuffer);

  function writeString(position, value) {
    for (let i = 0; i < value.length; i += 1) {
      view.setUint8(position + i, value.charCodeAt(i));
    }
  }

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(36, "data");
  view.setUint32(40, dataSize, true);

  let index = 44;
  for (const sample of samples) {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(index, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    index += 2;
  }

  return new Blob([view], { type: "audio/wav" });
}

async function startRecording() {
  recordingStream = await navigator.mediaDevices.getUserMedia({ audio: true });
  audioContext = new AudioContext();
  audioSource = audioContext.createMediaStreamSource(recordingStream);
  audioProcessor = audioContext.createScriptProcessor(4096, 1, 1);
  recordingBuffers = [];
  recordingLength = 0;

  audioProcessor.onaudioprocess = (event) => {
    if (!isRecording) return;
    const channel = event.inputBuffer.getChannelData(0);
    recordingBuffers.push(new Float32Array(channel));
    recordingLength += channel.length;
  };

  audioSource.connect(audioProcessor);
  audioProcessor.connect(audioContext.destination);
  isRecording = true;
  recordButton.textContent = "Stop";
  recordStatus.textContent = "Recording...";
}

async function stopRecording() {
  isRecording = false;
  audioProcessor?.disconnect();
  audioSource?.disconnect();
  recordingStream?.getTracks().forEach((track) => track.stop());

  const wavBlob = encodeWav(recordingBuffers, audioContext.sampleRate);
  await audioContext.close();
  const file = blobToWavFile(wavBlob, voiceName.value || "browser-recording");
  const transfer = new DataTransfer();
  transfer.items.add(file);
  voiceFile.files = transfer.files;
  recordStatus.textContent = "Recording captured as WAV.";
  recordButton.textContent = "Record WAV";
}

recordButton.addEventListener("click", async () => {
  try {
    if (isRecording) {
      await stopRecording();
      return;
    }
    await startRecording();
  } catch (error) {
    recordStatus.textContent = `Microphone unavailable: ${error.message}`;
  }
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const file = voiceFile.files[0];

  if (!file) return;
  if (!file.name.toLowerCase().endsWith(".wav") && file.type !== "audio/wav") {
    recordStatus.textContent = "Please use a `.wav` reference recording.";
    return;
  }

  await saveVoice({
    id: crypto.randomUUID(),
    name: voiceName.value.trim(),
    prompt: voicePrompt.value.trim(),
    fileName: file.name,
    blob: file,
    createdAt: Date.now()
  });

  form.reset();
  recordStatus.textContent = "Voice saved locally.";
  await renderVoices();
});

clearForm.addEventListener("click", () => {
  form.reset();
  recordStatus.textContent = "Ready for a phone `.wav` upload or browser recording.";
});

cloneVoice.addEventListener("change", renderJob);
cloneText.addEventListener("input", renderJob);

copyJob.addEventListener("click", async () => {
  await navigator.clipboard.writeText(jobPreview.textContent);
  copyJob.textContent = "Copied";
  setTimeout(() => {
    copyJob.textContent = "Copy job JSON";
  }, 1200);
});

exportJson.addEventListener("click", async () => {
  const voices = await getAllVoices();
  const manifest = voices.map(({ blob, ...voice }) => ({
    ...voice,
    size: blob.size,
    type: blob.type || "audio/wav"
  }));
  const blob = new Blob([JSON.stringify({ app: "VoiceFun", voices: manifest }, null, 2)], {
    type: "application/json"
  });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = "voicefun-library.json";
  link.click();
  URL.revokeObjectURL(link.href);
});

openDb()
  .then((database) => {
    db = database;
    return renderVoices();
  })
  .catch((error) => {
    document.body.innerHTML = `<main class="panel"><h1>VoiceFun</h1><p>Could not open local storage: ${error.message}</p></main>`;
  });
