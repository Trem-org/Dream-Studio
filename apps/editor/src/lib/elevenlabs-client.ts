/**
 * elevenlabs-client.ts
 *
 * Thin browser-side client for the /api/elevenlabs/* Vite server plugin.
 * Forwards the ElevenLabs API key from Vibe Settings (localStorage) to the
 * server proxy via the `x-elevenlabs-api-key` header.
 */

import { loadCopilotSettings } from "./copilot/settings";

export interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  preview_url: string | null;
  category: string;
}

export interface TtsOptions {
  voiceId?: string;
  modelId?: string;
}

type ElevenLabsErrorPayload = {
  detail?: string;
  error?: string;
};

/** Build common headers that include the API key when available. */
function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  const key = loadCopilotSettings().elevenlabsApiKey;
  if (key) headers["x-elevenlabs-api-key"] = key;
  return headers;
}

async function readElevenLabsError(
  response: Response,
  kind: "music" | "SFX" | "TTS" | "voices" | "voice clone" | "voice delete" | "Scribe token",
): Promise<string> {
  const payload = await response.json().catch(() => null) as ElevenLabsErrorPayload | null;
  const error = payload?.error?.trim();
  const detail = payload?.detail?.trim();

  if (response.status === 401) {
    return detail || error
      ? `ElevenLabs ${kind} authorization failed: ${detail || error}`
      : "ElevenLabs API key is missing, invalid, or expired. Open Vibe Settings and update the key.";
  }

  if (response.status === 403) {
    return "Your ElevenLabs account does not have permission to use this feature.";
  }

  if (response.status === 429) {
    return "ElevenLabs rate limit or credits limit reached. Try again shortly.";
  }

  if (detail || error) {
    return `ElevenLabs ${kind} failed: ${detail || error}`;
  }

  return `ElevenLabs ${kind} failed with status ${response.status}.`;
}

/**
 * Convert text to speech. Returns an AudioBuffer ready to play via Web Audio API.
 * Streams the mp3 from the server plugin then decodes it in the browser.
 */
export async function textToSpeech(text: string, opts: TtsOptions = {}): Promise<AudioBuffer> {
  const response = await fetch("/api/elevenlabs/tts", {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ text, ...opts }),
  });

  if (!response.ok) {
    throw new Error(await readElevenLabsError(response, "TTS"));
  }

  const arrayBuffer = await response.arrayBuffer();
  const audioCtx = getAudioContext();
  return audioCtx.decodeAudioData(arrayBuffer);
}

/**
 * Play text directly. Resolves when playback finishes.
 */
export async function speak(text: string, opts: TtsOptions = {}): Promise<void> {
  const buffer = await textToSpeech(text, opts);
  return playBuffer(buffer);
}

/**
 * Play a decoded AudioBuffer once.
 */
export function playBuffer(buffer: AudioBuffer): Promise<void> {
  return new Promise((resolve) => {
    const ctx = getAudioContext();
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.onended = () => resolve();
    source.start();
  });
}

/**
 * Fetch available voices from the ElevenLabs API (proxied via server plugin).
 */
export async function fetchVoices(): Promise<ElevenLabsVoice[]> {
  const response = await fetch("/api/elevenlabs/voices", {
    headers: authHeaders(),
  });
  if (!response.ok) {
    throw new Error(await readElevenLabsError(response, "voices"));
  }
  const data = await response.json() as { voices: ElevenLabsVoice[] };
  return data.voices ?? [];
}

/**
 * Generate a sound effect from a text description.
 * Returns an AudioBuffer ready to play via Web Audio API.
 */
export async function generateSoundEffect(
  description: string,
  durationSeconds?: number,
): Promise<AudioBuffer> {
  const response = await fetch("/api/elevenlabs/sfx", {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ description, durationSeconds }),
  });

  if (!response.ok) {
    throw new Error(await readElevenLabsError(response, "SFX"));
  }

  const arrayBuffer = await response.arrayBuffer();
  const audioCtx = getAudioContext();
  return audioCtx.decodeAudioData(arrayBuffer);
}

/**
 * Clone a voice from an audio file blob.
 * Returns the new voice_id.
 */
export async function cloneVoice(name: string, audioFile: File): Promise<string> {
  const form = new FormData();
  form.append("name", name);
  form.append("files", audioFile);

  const key = loadCopilotSettings().elevenlabsApiKey;
  const headers: Record<string, string> = {};
  if (key) headers["x-elevenlabs-api-key"] = key;

  const response = await fetch("/api/elevenlabs/voices/add", {
    method: "POST",
    headers,
    body: form,
  });

  if (!response.ok) {
    throw new Error(await readElevenLabsError(response, "voice clone"));
  }

  const data = await response.json() as { voice_id: string };
  return data.voice_id;
}

/**
 * Generate a sound effect and return a persistent blob URL.
 * Stores the audio as a blob URL suitable for persisting in scene settings.
 */
export async function generateSoundEffectUrl(
  description: string,
  durationSeconds?: number,
): Promise<string> {
  const response = await fetch("/api/elevenlabs/sfx", {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ description, durationSeconds }),
  });

  if (!response.ok) {
    throw new Error(await readElevenLabsError(response, "SFX"));
  }

  const blob = await response.blob();
  return URL.createObjectURL(blob);
}

export async function generateSoundEffectDataUrl(
  description: string,
  durationSeconds?: number,
): Promise<string> {
  const response = await fetch("/api/elevenlabs/sfx", {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ description, durationSeconds }),
  });

  if (!response.ok) {
    throw new Error(await readElevenLabsError(response, "SFX"));
  }

  const blob = await response.blob();
  return blobToDataUrl(blob);
}

export async function generateMusicDataUrl(
  description: string,
  durationSeconds?: number,
): Promise<string> {
  const response = await fetch("/api/elevenlabs/music", {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ description, durationSeconds }),
  });

  if (!response.ok) {
    throw new Error(await readElevenLabsError(response, "music"));
  }

  const blob = await response.blob();
  return blobToDataUrl(blob);
}

/**
 * Delete a cloned voice.
 */
export async function deleteVoice(voiceId: string): Promise<void> {
  const response = await fetch(`/api/elevenlabs/voices/${voiceId}`, {
    method: "DELETE",
    headers: authHeaders(),
  });
  if (!response.ok) {
    throw new Error(await readElevenLabsError(response, "voice delete"));
  }
}

let _audioCtx: AudioContext | null = null;
function getAudioContext(): AudioContext {
  if (!_audioCtx || _audioCtx.state === "closed") {
    _audioCtx = new AudioContext();
  }
  if (_audioCtx.state === "suspended") {
    _audioCtx.resume().catch(() => {});
  }
  return _audioCtx;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsDataURL(blob);
  });
}

export async function setupSpeechEngine(): Promise<void> {
  const settings = loadCopilotSettings();
  if (!settings.elevenlabsApiKey || !settings.elevenlabsSpeechEngineId) {
    return;
  }

  const response = await fetch("/api/elevenlabs/speech-engine/setup", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      elevenlabsApiKey: settings.elevenlabsApiKey,
      elevenlabsSpeechEngineId: settings.elevenlabsSpeechEngineId,
      geminiApiKey: settings.geminiApiKey,
      geminiModel: settings.gemini.model,
      temperature: settings.temperature
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("[elevenlabs-client] Speech Engine setup failed:", errorText);
    throw new Error(`Speech Engine setup failed: ${response.statusText}`);
  }
}

export async function getScribeToken(): Promise<string> {
  const response = await fetch("/api/elevenlabs/scribe-token", {
    method: "POST",
    headers: authHeaders(),
  });

  if (!response.ok) {
    throw new Error(await readElevenLabsError(response, "Scribe token"));
  }

  const data = await response.json() as string | { token?: string };
  const token = typeof data === "string" ? data : data.token;

  if (!token) {
    throw new Error("ElevenLabs Scribe token response did not include a token.");
  }

  return token;
}
