/**
 * elevenlabs-api.ts
 *
 * Proxies ElevenLabs requests so the browser never hits the API directly.
 *
 * Auth: The browser sends the API key (from Vibe Settings / localStorage) via
 * the `x-elevenlabs-api-key` request header. The server forwards it to
 * ElevenLabs as `xi-api-key`.
 */

import type { Plugin, PreviewServer, ViteDevServer } from "vite";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { GoogleGenAI } from "@google/genai";
import type { TranscriptMessage } from "@elevenlabs/elevenlabs-js/wrapper/speech-engine/types";
import type { SpeechEngineSession } from "@elevenlabs/elevenlabs-js/wrapper/speech-engine/SpeechEngineSession";

let activeAttachment: any = null;
let currentConfig: {
  elevenlabsApiKey: string;
  elevenlabsSpeechEngineId: string;
  geminiApiKey: string;
  geminiModel: string;
  temperature: number;
} | null = null;

const ELEVENLABS_BASE = "https://api.elevenlabs.io";

const TTS_PATH = "/api/elevenlabs/tts";
const VOICES_PATH = "/api/elevenlabs/voices";
const SFX_PATH = "/api/elevenlabs/sfx";
const MUSIC_PATH = "/api/elevenlabs/music";
const VOICE_ADD_PATH = "/api/elevenlabs/voices/add";
const VOICE_DEL_PREFIX = "/api/elevenlabs/voices/";

const DEFAULT_VOICE_ID = "JBFqnCBsd6RMkjVDRZzb";
const DEFAULT_MODEL_ID = "eleven_multilingual_v2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, x-elevenlabs-api-key",
};

export function createElevenLabsApiPlugin(): Plugin {
  return {
    name: "elevenlabs-api",
    configureServer(server) {
      registerApi(server);
    },
    configurePreviewServer(server) {
      registerApi(server);
    },
  };
}

function registerApi(
  server: ViteDevServer | PreviewServer,
) {
  const envApiKey = process.env.ELEVENLABS_API_KEY?.trim();
  const envEngineId = process.env.ELEVENLABS_SPEECH_ENGINE_ID?.trim();
  if (envApiKey && envEngineId && server.httpServer) {
    const geminiApiKey = process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim();
    if (geminiApiKey) {
      console.log(`[elevenlabs-api] Auto-initializing Speech Engine ${envEngineId} from env variables`);
      const client = new ElevenLabsClient({ apiKey: envApiKey });
      const path = "/api/elevenlabs/speech-engine/ws";
      (client as any).speechEngine.attach(
        envEngineId,
        server.httpServer as any,
        path,
        {
          debug: true,
          onTranscript: async (transcript: TranscriptMessage[], signal: AbortSignal, session: SpeechEngineSession) => {
            console.log("[elevenlabs-api] Received speech engine transcript (env):", transcript);
            try {
              const contents = transcript.map((msg: TranscriptMessage) => ({
                role: msg.role === "user" ? "user" : "model",
                parts: [{ text: msg.content }]
              }));

              const ai = new GoogleGenAI({ apiKey: geminiApiKey });
              const responseStream = await ai.models.generateContentStream({
                model: "gemini-3.1-pro-preview",
                contents,
                config: {
                  temperature: 0.7,
                  maxOutputTokens: 1024,
                  systemInstruction: "You are a helpful, real-time voice assistant. Respond with natural, conversational spoken dialogue only. Keep responses short (1-3 sentences) and optimized for text-to-speech."
                }
              });

              const textChunkGenerator = async function* () {
                for await (const chunk of responseStream) {
                  if (signal.aborted) {
                    break;
                  }
                  if (chunk.text) {
                    yield chunk.text;
                  }
                }
              };

              await session.sendResponse(textChunkGenerator());
            } catch (err) {
              console.error("[elevenlabs-api] Error generating reply via Gemini (env):", err);
              session.sendResponse("Sorry, I encountered an error generating a response.");
            }
          },
          onInit: (conversationId: string) => {
            console.log("[elevenlabs-api] Speech engine session initialized (env):", conversationId);
          },
          onClose: () => {
            console.log("[elevenlabs-api] Speech engine session closed (env).");
          },
          onError: (error: Error) => {
            console.error("[elevenlabs-api] Speech engine error (env):", error);
          }
        }
      ).then((attachment: any) => {
        activeAttachment = attachment;
      }).catch((err: any) => {
        console.error("[elevenlabs-api] Failed to auto-initialize Speech Engine from env variables:", err);
      });
    }
  }

  server.middlewares.use(async (req, res, next) => {
    const pathname = req.url?.split("?")[0];

    const isSpeechEngineSetup = pathname === "/api/elevenlabs/speech-engine/setup" || pathname?.endsWith("/api/elevenlabs/speech-engine/setup");
    if (isSpeechEngineSetup && req.method === "POST") {
      await handleSpeechEngineSetup(req, res, server.httpServer as any);
      return;
    }

    if (req.method === "OPTIONS" && pathname?.startsWith("/api/elevenlabs/")) {
      res.writeHead(204, CORS_HEADERS);
      res.end();
      return;
    }

    const isVoices = pathname === VOICES_PATH || pathname?.endsWith(VOICES_PATH);
    const isTts = pathname === TTS_PATH || pathname?.endsWith(TTS_PATH);
    const isSfx = pathname === SFX_PATH || pathname?.endsWith(SFX_PATH);
    const isMusic = pathname === MUSIC_PATH || pathname?.endsWith(MUSIC_PATH);
    const isVoiceAdd = pathname === VOICE_ADD_PATH || pathname?.endsWith(VOICE_ADD_PATH);
    const isVoiceDel = pathname?.includes(VOICE_DEL_PREFIX) && req.method === "DELETE";

    if (isVoices && req.method === "GET") {
      await handleVoices(req, res);
      return;
    }

    if (isTts && req.method === "POST") {
      await handleTts(req, res);
      return;
    }

    if (isSfx && req.method === "POST") {
      await handleSfx(req, res);
      return;
    }

    if (isMusic && req.method === "POST") {
      await handleMusic(req, res);
      return;
    }

    if (isVoiceAdd && req.method === "POST") {
      await handleVoiceAdd(req, res);
      return;
    }

    if (isVoiceDel) {
      const parts = pathname!.split(VOICE_DEL_PREFIX);
      const voiceId = parts[parts.length - 1];
      await handleVoiceDelete(req, voiceId, res);
      return;
    }

    next();
  });
}

function getClientKey(req: import("node:http").IncomingMessage): string | undefined {
  const value = req.headers["x-elevenlabs-api-key"];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

async function elevenLabsFetch(
  path: string,
  init: RequestInit = {},
  clientApiKey?: string,
): Promise<Response> {
  if (!clientApiKey) {
    throw new Error(
      "No ElevenLabs API key provided. Set it in Vibe Settings.",
    );
  }

  const headers = new Headers(init.headers as HeadersInit | undefined);
  headers.set("xi-api-key", clientApiKey);

  return fetch(`${ELEVENLABS_BASE}${path}`, { ...init, headers });
}

function createElevenLabsClient(clientApiKey?: string) {
  if (!clientApiKey) {
    throw new Error(
      "No ElevenLabs API key provided. Set it in Vibe Settings.",
    );
  }

  return new ElevenLabsClient({ apiKey: clientApiKey });
}

async function readUpstreamErrorDetail(response: Response): Promise<string> {
  const raw = await response.text();

  try {
    const parsed = JSON.parse(raw) as {
      detail?: unknown;
      error?: unknown;
      message?: unknown;
    };

    const detail =
      typeof parsed.detail === "string" ? parsed.detail :
      typeof parsed.error === "string" ? parsed.error :
      typeof parsed.message === "string" ? parsed.message :
      raw;

    return detail.trim() || `Upstream status ${response.status}`;
  } catch {
    return raw.trim() || `Upstream status ${response.status}`;
  }
}

function readSdkErrorDetail(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === "object" && error) {
    const maybeError = error as {
      body?: unknown;
      message?: unknown;
      statusCode?: unknown;
    };

    if (typeof maybeError.body === "string") {
      return maybeError.body;
    }

    if (maybeError.body) {
      try {
        return JSON.stringify(maybeError.body);
      } catch {
        return String(maybeError.body);
      }
    }

    if (typeof maybeError.message === "string") {
      return maybeError.message;
    }
  }

  return "ElevenLabs request failed.";
}

function readSdkStatus(error: unknown) {
  if (typeof error === "object" && error) {
    const maybeError = error as { statusCode?: unknown; status?: unknown };
    const status = typeof maybeError.statusCode === "number"
      ? maybeError.statusCode
      : typeof maybeError.status === "number"
        ? maybeError.status
        : undefined;

    if (status && status >= 400 && status < 600) {
      return status;
    }
  }

  return 500;
}

async function pipeAudioStream(
  res: import("node:http").ServerResponse,
  stream: ReadableStream<Uint8Array>,
) {
  res.writeHead(200, {
    ...CORS_HEADERS,
    "Content-Type": "audio/mpeg",
    "Cache-Control": "no-store",
  });

  const reader = stream.getReader();

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    res.write(Buffer.from(value));
  }

  res.end();
}

async function handleVoices(
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
) {
  try {
    const response = await elevenLabsFetch("/v1/voices", { method: "GET" }, getClientKey(req));

    if (!response.ok) {
      const detail = await readUpstreamErrorDetail(response);
      console.error("[elevenlabs-api] voices upstream error", response.status, detail);
      sendJson(res, response.status, { error: "Failed to fetch voices.", detail });
      return;
    }

    const data = await response.json() as unknown;
    sendJson(res, 200, data);
  } catch (error) {
    console.error("[elevenlabs-api] voices error", error);
    sendJson(res, 500, {
      error: error instanceof Error ? error.message : "Failed to fetch voices.",
    });
  }
}

async function handleTts(
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
) {
  try {
    const body = await readJson<{ text: string; voiceId?: string; modelId?: string }>(req);

    if (!body?.text?.trim()) {
      sendJson(res, 400, { error: "text is required." });
      return;
    }

    const voiceId = body.voiceId ?? DEFAULT_VOICE_ID;
    const modelId = body.modelId ?? DEFAULT_MODEL_ID;
    const response = await elevenLabsFetch(
      `/v1/text-to-speech/${voiceId}/stream?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: body.text,
          model_id: modelId,
        }),
      },
      getClientKey(req),
    );

    if (!response.ok) {
      const detail = await readUpstreamErrorDetail(response);
      console.error("[elevenlabs-api] TTS upstream error", response.status, detail);
      sendJson(res, response.status, { error: "ElevenLabs TTS failed.", detail });
      return;
    }

    res.writeHead(200, {
      ...CORS_HEADERS,
      "Content-Type": "audio/mpeg",
      "Cache-Control": "no-store",
      "Transfer-Encoding": "chunked",
    });

    const reader = response.body?.getReader();
    if (!reader) {
      res.end();
      return;
    }

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      res.write(Buffer.from(value));
    }

    res.end();
  } catch (error) {
    console.error("[elevenlabs-api] TTS error", error);
    sendJson(res, 500, {
      error: error instanceof Error ? error.message : "Internal server error.",
    });
  }
}

async function handleSfx(
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
) {
  try {
    const body = await readJson<{ description: string; durationSeconds?: number }>(req);

    if (!body?.description?.trim()) {
      sendJson(res, 400, { error: "description is required." });
      return;
    }

    const client = createElevenLabsClient(getClientKey(req));
    const durationSeconds = typeof body.durationSeconds === "number"
      ? Math.max(0.5, Math.min(30, body.durationSeconds))
      : undefined;

    const audio = await generateSfxWithMusicFallback(client, body.description, durationSeconds);

    await pipeAudioStream(res, audio);
  } catch (error) {
    console.error("[elevenlabs-api] SFX error", error);
    sendJson(res, 500, {
      error: "ElevenLabs SFX failed.",
      detail: readSdkErrorDetail(error),
    });
  }
}

async function generateSfxWithMusicFallback(
  client: ElevenLabsClient,
  description: string,
  durationSeconds?: number,
) {
  try {
    return await client.textToSoundEffects.convert({
      durationSeconds,
      modelId: "eleven_text_to_sound_v2",
      outputFormat: "mp3_44100_128",
      promptInfluence: 0.3,
      text: description,
    });
  } catch (error) {
    const status = readSdkStatus(error);
    if (status !== 401 && status !== 403) {
      throw error;
    }

    console.warn("[elevenlabs-api] SFX endpoint unavailable; falling back to Eleven Music.", readSdkErrorDetail(error));
    return client.music.compose({
      forceInstrumental: true,
      musicLengthMs: Math.max(3000, Math.min(12000, Math.round((durationSeconds ?? 3) * 1000))),
      outputFormat: "mp3_44100_128",
      prompt: `Create a short sound effect, not a song: ${description}`,
    });
  }
}

async function handleMusic(
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
) {
  try {
    const body = await readJson<{ description: string; durationSeconds?: number }>(req);

    if (!body?.description?.trim()) {
      sendJson(res, 400, { error: "description is required." });
      return;
    }

    const musicLengthMs = body.durationSeconds
      ? Math.max(3000, Math.min(600000, Math.round(body.durationSeconds * 1000)))
      : 10000;

    const client = createElevenLabsClient(getClientKey(req));
    const audio = await client.music.compose({
      forceInstrumental: true,
      musicLengthMs,
      outputFormat: "mp3_44100_128",
      prompt: body.description,
    });

    await pipeAudioStream(res, audio);
  } catch (error) {
    console.error("[elevenlabs-api] music error", error);
    sendJson(res, 500, {
      error: "ElevenLabs music failed.",
      detail: readSdkErrorDetail(error),
    });
  }
}

async function handleVoiceAdd(
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
) {
  try {
    const chunks: Buffer[] = [];

    await new Promise<void>((resolve, reject) => {
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", resolve);
      req.on("error", reject);
    });

    const rawBody = Buffer.concat(chunks);
    const response = await elevenLabsFetch(
      "/v1/voices/add",
      {
        method: "POST",
        headers: {
          "Content-Type": req.headers["content-type"] ?? "multipart/form-data",
          "Content-Length": String(rawBody.byteLength),
        },
        body: rawBody as unknown as BodyInit,
      },
      getClientKey(req),
    );

    if (!response.ok) {
      const detail = await readUpstreamErrorDetail(response);
      console.error("[elevenlabs-api] voice add upstream error", response.status, detail);
      sendJson(res, response.status, { error: "Voice clone failed.", detail });
      return;
    }

    const data = await response.json() as unknown;
    sendJson(res, 200, data);
  } catch (error) {
    console.error("[elevenlabs-api] voice add error", error);
    sendJson(res, 500, {
      error: error instanceof Error ? error.message : "Internal server error.",
    });
  }
}

async function handleVoiceDelete(
  req: import("node:http").IncomingMessage,
  voiceId: string,
  res: import("node:http").ServerResponse,
) {
  try {
    const response = await elevenLabsFetch(
      `/v1/voices/${voiceId}`,
      { method: "DELETE" },
      getClientKey(req),
    );

    if (!response.ok) {
      const detail = await readUpstreamErrorDetail(response);
      sendJson(res, response.status, { error: "Voice delete failed.", detail });
      return;
    }

    sendJson(res, 200, { ok: true });
  } catch (error) {
    console.error("[elevenlabs-api] voice delete error", error);
    sendJson(res, 500, {
      error: error instanceof Error ? error.message : "Internal server error.",
    });
  }
}

function sendJson(res: import("node:http").ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { ...CORS_HEADERS, "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

async function readJson<T>(req: import("node:http").IncomingMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];

    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as T);
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

async function handleSpeechEngineSetup(
  req: import("node:http").IncomingMessage,
  res: import("node:http").ServerResponse,
  httpServer: import("node:http").Server | null,
) {
  try {
    if (!httpServer) {
      sendJson(res, 500, { error: "No HTTP server available to attach Speech Engine." });
      return;
    }

    const body = await readJson<{
      elevenlabsApiKey: string;
      elevenlabsSpeechEngineId: string;
      geminiApiKey: string;
      geminiModel: string;
      temperature: number;
    }>(req);

    if (!body?.elevenlabsApiKey?.trim() || !body?.elevenlabsSpeechEngineId?.trim()) {
      sendJson(res, 400, { error: "ElevenLabs API Key and Speech Engine ID are required." });
      return;
    }

    if (activeAttachment) {
      try {
        await activeAttachment.close();
      } catch (err) {
        console.error("[elevenlabs-api] Error closing active attachment:", err);
      }
      activeAttachment = null;
    }

    currentConfig = body;

    const client = new ElevenLabsClient({ apiKey: body.elevenlabsApiKey });
    const path = "/api/elevenlabs/speech-engine/ws";
    console.log(`[elevenlabs-api] Attaching Speech Engine ${body.elevenlabsSpeechEngineId} to ${path}`);

    activeAttachment = await (client as any).speechEngine.attach(
      body.elevenlabsSpeechEngineId,
      httpServer as any,
      path,
      {
        debug: true,
        onTranscript: async (transcript: TranscriptMessage[], signal: AbortSignal, session: SpeechEngineSession) => {
          console.log("[elevenlabs-api] Received speech engine transcript:", transcript);
          try {
            const geminiApiKey = currentConfig?.geminiApiKey?.trim() || process.env.GEMINI_API_KEY?.trim() || process.env.GOOGLE_API_KEY?.trim();
            const geminiModel = currentConfig?.geminiModel || "gemini-3.1-pro-preview";
            const temperature = currentConfig?.temperature ?? 0.7;

            if (!geminiApiKey) {
              console.error("[elevenlabs-api] Missing Gemini API Key configuration.");
              session.sendResponse("Error: Gemini API Key is not configured in settings.");
              return;
            }

            const contents = transcript.map((msg: TranscriptMessage) => ({
              role: msg.role === "user" ? "user" : "model",
              parts: [{ text: msg.content }]
            }));

            const ai = new GoogleGenAI({ apiKey: geminiApiKey });
            const responseStream = await ai.models.generateContentStream({
              model: geminiModel,
              contents,
              config: {
                temperature,
                maxOutputTokens: 1024,
                systemInstruction: "You are a helpful, real-time voice assistant. Respond with natural, conversational spoken dialogue only. Keep responses short (1-3 sentences) and optimized for text-to-speech."
              }
            });

            const textChunkGenerator = async function* () {
              for await (const chunk of responseStream) {
                if (signal.aborted) {
                  console.log("[elevenlabs-api] Speech engine response generation aborted.");
                  break;
                }
                if (chunk.text) {
                  yield chunk.text;
                }
              }
            };

            await session.sendResponse(textChunkGenerator());
          } catch (err) {
            console.error("[elevenlabs-api] Error generating reply via Gemini:", err);
            session.sendResponse("Sorry, I encountered an error generating a response.");
          }
        },
        onInit: (conversationId: string) => {
          console.log("[elevenlabs-api] Speech engine session initialized:", conversationId);
        },
        onClose: () => {
          console.log("[elevenlabs-api] Speech engine session closed.");
        },
        onError: (error: Error) => {
          console.error("[elevenlabs-api] Speech engine error:", error);
        }
      }
    );

    sendJson(res, 200, { ok: true });
  } catch (error) {
    console.error("[elevenlabs-api] Speech Engine setup error:", error);
    sendJson(res, 500, {
      error: error instanceof Error ? error.message : "Internal server error.",
    });
  }
}
