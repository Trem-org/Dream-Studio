import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EditorCore } from "@blud/editor-core";
import type { AiAssistantMode, CopilotImageAttachment, CopilotSession } from "@/lib/copilot/types";
import { isCopilotConfigured, loadCopilotSettings } from "@/lib/copilot/settings";
import type { CopilotToolExecutionContext } from "@/lib/copilot/tool-executor";
import { appendSkillContextToPrompt, discoverCopilotSkills } from "@/lib/copilot/skills";
import {
  buildMorphusPreviewHtml,
  createMorphusFilesFromAssistantContent,
  createMorphusFilesFromGame,
  inferMorphusFileLanguage,
  loadMorphusMemory,
  saveMorphusMemory,
  type MorphusFileRecord
} from "@/lib/copilot/morphus-memory";
import { setupSpeechEngine } from "@/lib/elevenlabs-client";

export type GeneratedGame = { title: string; html: string };

const EMPTY_SESSION: CopilotSession = {
  messages: [],
  activity: [],
  status: "idle",
  iterationCount: 0
};

const MORPHUS_DEFAULT_READ_CHARS = 24000;
const MORPHUS_MAX_READ_CHARS = 42000;
const MORPHUS_RUN_READ_CHAR_BUDGET = 90000;
const MORPHUS_RUN_UNIQUE_READ_BUDGET = 8;

type MorphusReadFileOptions = {
  endLine?: number;
  maxChars?: number;
  startLine?: number;
};

type MorphusSearchFilesOptions = {
  includeAssets?: boolean;
  maxResults?: number;
  pathGlob?: string;
  useRegex?: boolean;
};

type CopilotRuntime = {
  runAgenticLoop: typeof import("@/lib/copilot/agentic-loop").runAgenticLoop;
  createCopilotProvider: typeof import("@/lib/copilot/provider").createCopilotProvider;
  buildEditorSystemPrompt: typeof import("@/lib/copilot/system-prompt").buildEditorSystemPrompt;
  buildMorphusSystemPrompt: typeof import("@/lib/copilot/system-prompt").buildMorphusSystemPrompt;
  EDITOR_COPILOT_TOOL_DECLARATIONS: typeof import("@/lib/copilot/tool-declarations").EDITOR_COPILOT_TOOL_DECLARATIONS;
  GAME_TOOL_DECLARATIONS: typeof import("@/lib/copilot/tool-declarations").GAME_TOOL_DECLARATIONS;
  executeTool: typeof import("@/lib/copilot/tool-executor").executeTool;
};

let copilotRuntimePromise: Promise<CopilotRuntime> | null = null;

function loadCopilotRuntime(): Promise<CopilotRuntime> {
  if (!copilotRuntimePromise) {
    copilotRuntimePromise = Promise.all([
      import("@/lib/copilot/agentic-loop"),
      import("@/lib/copilot/provider"),
      import("@/lib/copilot/system-prompt"),
      import("@/lib/copilot/tool-declarations"),
      import("@/lib/copilot/tool-executor")
    ]).then(([agenticLoop, provider, systemPrompt, toolDeclarations, toolExecutor]) => ({
      runAgenticLoop: agenticLoop.runAgenticLoop,
      createCopilotProvider: provider.createCopilotProvider,
      buildEditorSystemPrompt: systemPrompt.buildEditorSystemPrompt,
      buildMorphusSystemPrompt: systemPrompt.buildMorphusSystemPrompt,
      EDITOR_COPILOT_TOOL_DECLARATIONS: toolDeclarations.EDITOR_COPILOT_TOOL_DECLARATIONS,
      GAME_TOOL_DECLARATIONS: toolDeclarations.GAME_TOOL_DECLARATIONS,
      executeTool: toolExecutor.executeTool
    }));
  }

  return copilotRuntimePromise;
}

function extractHtmlFromMessages(messages: CopilotSession["messages"]): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role !== "assistant" || !message.content) {
      continue;
    }

    const match = /```html\s*([\s\S]+?)```/i.exec(message.content);
    if (match) {
      return match[1].trim();
    }
  }

  return null;
}

function cloneSession(updated: CopilotSession): CopilotSession {
  return {
    ...updated,
    messages: [...updated.messages],
    activity: [...updated.activity]
  };
}

function mergeMorphusFiles(
  existingFiles: MorphusFileRecord[],
  incomingFiles: MorphusFileRecord[]
): MorphusFileRecord[] {
  if (incomingFiles.length === 0) {
    return existingFiles;
  }

  const byPath = new Map(existingFiles.map((file) => [file.path, file]));

  for (const file of incomingFiles) {
    byPath.set(file.path, file);
  }

  return Array.from(byPath.values()).sort((a, b) => a.path.localeCompare(b.path));
}

function normalizeMorphusPath(path: string) {
  return path.replace(/\\/g, "/").replace(/^\.?\//, "").trim();
}

function isMorphusAssetFile(file: MorphusFileRecord) {
  return file.language === "asset" || /\.(glb|bin|png|jpe?g|webp|gif|svg|hdr|exr|ktx2|mp3|wav|ogg|fbx|obj|mtl|usdz)$/i.test(file.path);
}

function summarizeMorphusFile(file: MorphusFileRecord) {
  return {
    language: file.language,
    path: file.path,
    size: file.content.length,
    updatedAt: file.updatedAt
  };
}

function clampMorphusReadChars(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return MORPHUS_DEFAULT_READ_CHARS;
  }

  return Math.max(1000, Math.min(Math.round(value), MORPHUS_MAX_READ_CHARS));
}

function sliceMorphusContent(content: string, options?: MorphusReadFileOptions) {
  const lines = content.split(/\r?\n/);
  const hasLineSlice =
    typeof options?.startLine === "number" ||
    typeof options?.endLine === "number";
  const startLine = hasLineSlice
    ? Math.max(1, Math.floor(options?.startLine ?? 1))
    : 1;
  const endLine = hasLineSlice
    ? Math.max(startLine, Math.min(lines.length, Math.floor(options?.endLine ?? lines.length)))
    : lines.length;
  const slicedContent = hasLineSlice
    ? lines.slice(startLine - 1, endLine).join("\n")
    : content;
  const maxChars = clampMorphusReadChars(options?.maxChars);
  const truncated = slicedContent.length > maxChars;

  return {
    content: truncated ? slicedContent.slice(0, maxChars) : slicedContent,
    endLine,
    lineSliced: hasLineSlice,
    maxChars,
    startLine,
    totalLines: lines.length,
    totalSize: content.length,
    truncated
  };
}

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function clampMorphusSearchResults(value?: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 12;
  }

  return Math.max(1, Math.min(Math.round(value), 30));
}

function buildMorphusSearchPattern(query: string, useRegex?: boolean) {
  const trimmed = query.trim();
  if (!trimmed) {
    throw new Error("Search query is required.");
  }

  return new RegExp(useRegex ? trimmed : escapeRegex(trimmed), "i");
}

function createMorphusSearchSnippet(line: string, matchIndex: number, matchLength: number) {
  const radius = 72;
  const start = Math.max(0, matchIndex - radius);
  const end = Math.min(line.length, matchIndex + Math.max(matchLength, 1) + radius);
  const prefix = start > 0 ? "..." : "";
  const suffix = end < line.length ? "..." : "";

  return `${prefix}${line.slice(start, end).trim()}${suffix}`;
}

function createBudgetedMorphusToolContext(baseContext: CopilotToolExecutionContext): CopilotToolExecutionContext {
  let readCharsUsed = 0;
  const readCache = new Map<string, Record<string, unknown>>();
  const uniqueReadPaths = new Set<string>();

  return {
    ...baseContext,
    morphusReadFile: (path, options) => {
      const normalizedPath = normalizeMorphusPath(path);
      const cacheKey = JSON.stringify({
        path: normalizedPath,
        startLine: options?.startLine,
        endLine: options?.endLine,
        maxChars: options?.maxChars
      });

      if (readCache.has(cacheKey)) {
        const cached = readCache.get(cacheKey)!;
        return {
          cached: true,
          file: cached.file,
          message: "This file slice was already read during this run. Use the previous content instead of reading it again.",
          readBudget: {
            charsUsed: readCharsUsed,
            maxChars: MORPHUS_RUN_READ_CHAR_BUDGET,
            maxUniqueFiles: MORPHUS_RUN_UNIQUE_READ_BUDGET,
            uniqueFilesRead: uniqueReadPaths.size
          }
        };
      }

      if (!uniqueReadPaths.has(normalizedPath) && uniqueReadPaths.size >= MORPHUS_RUN_UNIQUE_READ_BUDGET) {
        return {
          budgetExceeded: true,
          message: "Morphus read budget reached for this run. Stop reading files and use the context already gathered to write the needed changes.",
          path: normalizedPath,
          readBudget: {
            charsUsed: readCharsUsed,
            maxChars: MORPHUS_RUN_READ_CHAR_BUDGET,
            maxUniqueFiles: MORPHUS_RUN_UNIQUE_READ_BUDGET,
            uniqueFilesRead: uniqueReadPaths.size
          }
        };
      }

      if (readCharsUsed >= MORPHUS_RUN_READ_CHAR_BUDGET) {
        return {
          budgetExceeded: true,
          message: "Morphus read character budget reached for this run. Stop reading files and use the context already gathered to write the needed changes.",
          path: normalizedPath,
          readBudget: {
            charsUsed: readCharsUsed,
            maxChars: MORPHUS_RUN_READ_CHAR_BUDGET,
            maxUniqueFiles: MORPHUS_RUN_UNIQUE_READ_BUDGET,
            uniqueFilesRead: uniqueReadPaths.size
          }
        };
      }

      const result = baseContext.morphusReadFile?.(normalizedPath, options);
      if (!result) {
        throw new Error("Morphus file reading is unavailable in this context.");
      }

      const content = typeof result.content === "string" ? result.content : "";
      readCharsUsed += content.length;
      uniqueReadPaths.add(normalizedPath);

      const budgetedResult = {
        ...result,
        readBudget: {
          charsUsed: readCharsUsed,
          maxChars: MORPHUS_RUN_READ_CHAR_BUDGET,
          maxUniqueFiles: MORPHUS_RUN_UNIQUE_READ_BUDGET,
          uniqueFilesRead: uniqueReadPaths.size
        }
      };

      readCache.set(cacheKey, budgetedResult);
      return budgetedResult;
    }
  };
}

function isMorphusAudioAssetPath(path: string) {
  return /^assets\/audio\/.+\.(mp3|wav|ogg|m4a)$/i.test(path);
}

function referencesAudioPath(content: string, audioPath: string) {
  const basename = audioPath.split("/").pop() ?? audioPath;
  return content.includes(audioPath) || content.includes(basename);
}

function inferAudioKind(path: string) {
  return /\b(loop|music|theme|bgm|background|track|chill|synthwave|pulse)\b/i.test(path) ? "music" : "sfx";
}

function ensureMorphusAudioIntegration(files: MorphusFileRecord[]) {
  const audioFiles = files.filter((file) => isMorphusAudioAssetPath(file.path));
  if (audioFiles.length === 0) {
    return files;
  }

  const indexFile = files.find((file) => file.path.toLowerCase() === "index.html");
  if (!indexFile) {
    return files;
  }

  const nonAssetFiles = files.filter((file) => file.language !== "asset");
  const hasExplicitAudioReferences = audioFiles.some((audioFile) =>
    nonAssetFiles.some((file) => file.path !== "morphus-audio-runtime.js" && referencesAudioPath(file.content, audioFile.path))
  );

  const runtimePath = "morphus-audio-runtime.js";
  const runtimeContent = buildMorphusAudioRuntime(audioFiles.map((file) => file.path), hasExplicitAudioReferences);
  const nextFiles = mergeMorphusFiles(
    files,
    [
      {
        content: runtimeContent,
        language: "javascript",
        path: runtimePath,
        updatedAt: Date.now()
      }
    ]
  );

  const nextIndexFile = nextFiles.find((file) => file.path.toLowerCase() === "index.html");
  if (!nextIndexFile) {
    return nextFiles;
  }

  const scriptTag = '<script type="module" src="./morphus-audio-runtime.js"></script>';
  if (nextIndexFile.content.includes(scriptTag)) {
    return nextFiles;
  }

  const updatedIndexContent = nextIndexFile.content.includes("</body>")
    ? nextIndexFile.content.replace("</body>", `  ${scriptTag}\n</body>`)
    : `${nextIndexFile.content}\n${scriptTag}\n`;

  return mergeMorphusFiles(
    nextFiles,
    [
      {
        ...nextIndexFile,
        content: updatedIndexContent,
        updatedAt: Date.now()
      }
    ]
  );
}

function buildMorphusAudioRuntime(audioPaths: string[], hasExplicitAudioReferences: boolean) {
  const assets = audioPaths.map((path) => ({
    kind: inferAudioKind(path),
    path
  }));

  return `const assets = ${JSON.stringify(assets, null, 2)};

let activeMusic = null;
let musicStarted = false;

function play(path, options = {}) {
  const audio = new Audio(path);
  audio.loop = Boolean(options.loop);
  audio.volume = typeof options.volume === "number" ? options.volume : 0.7;
  audio.play().catch(() => {});
  return audio;
}

function startBackgroundMusic() {
  if (musicStarted) return activeMusic;
  const track = assets.find((asset) => asset.kind === "music");
  if (!track) return null;
  musicStarted = true;
  activeMusic = play(track.path, { loop: true, volume: 0.55 });
  return activeMusic;
}

function playSfx(path, options = {}) {
  return play(path, { loop: false, volume: options.volume ?? 0.82 });
}

window.morphusAudio = {
  assets,
  play,
  playSfx,
  startBackgroundMusic,
  stopBackgroundMusic() {
    if (!activeMusic) return;
    activeMusic.pause();
    activeMusic.currentTime = 0;
    activeMusic = null;
    musicStarted = false;
  }
};

if (!${JSON.stringify(hasExplicitAudioReferences)}) {
  const unlock = () => {
    startBackgroundMusic();
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
  window.addEventListener("pointerdown", unlock, { once: true });
  window.addEventListener("keydown", unlock, { once: true });
}
`;
}

async function exportMorphusFilesToWorkspace(files: MorphusFileRecord[]) {
  const response = await fetch("/api/morphus/export", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      files: files.map((file) => ({
        content: file.content,
        language: file.language,
        path: file.path
      }))
    })
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(payload?.error || `Morphus export failed with status ${response.status}.`);
  }
}

export function useCopilot(
  editor: EditorCore,
  toolContext: CopilotToolExecutionContext = {},
  mode: AiAssistantMode = "copilot"
) {
  const [session, setSession] = useState<CopilotSession>(EMPTY_SESSION);
  const [configured, setConfigured] = useState(() => isCopilotConfigured());
  const [latestGame, setLatestGame] = useState<GeneratedGame | null>(null);
  const [files, setFiles] = useState<MorphusFileRecord[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const codexThreadIdRef = useRef<string | undefined>(undefined);
  const pendingGameTitleRef = useRef<string | null>(null);
  const memoryLoadedRef = useRef(false);
  const memoryKey = mode === "morphus" ? "morphus" : "copilot";
  const availableMorphusAudioFiles = useMemo(
    () => files
      .map((file) => file.path)
      .filter((path) => /^assets\/audio\//i.test(path))
      .sort((a, b) => a.localeCompare(b)),
    [files]
  );
  const availableMorphusImageFiles = useMemo(
    () => files
      .map((file) => file.path)
      .filter((path) => /^assets\/images\//i.test(path))
      .sort((a, b) => a.localeCompare(b)),
    [files]
  );
  const availableMorphusFilePaths = useMemo(
    () => files
      .map((file) => file.path)
      .sort((a, b) => a.localeCompare(b)),
    [files]
  );

  const publishSession = useCallback((updated: CopilotSession) => {
    const nextSession = cloneSession(updated);

    startTransition(() => {
      setSession(nextSession);
    });
  }, []);

  const mergedToolContext = useMemo<CopilotToolExecutionContext>(
    () => ({
      ...toolContext,
      morphusCreateFile: (path: string, content: string) => {
        const normalizedPath = normalizeMorphusPath(path);
        if (!normalizedPath) {
          throw new Error("File path is required.");
        }
        if (files.some((file) => file.path === normalizedPath)) {
          throw new Error(`File already exists: ${normalizedPath}`);
        }

        const nextFile: MorphusFileRecord = {
          content,
          language: inferMorphusFileLanguage(normalizedPath),
          path: normalizedPath,
          updatedAt: Date.now()
        };
        const nextFiles = ensureMorphusAudioIntegration(mergeMorphusFiles(files, [nextFile]));
        const html = buildMorphusPreviewHtml(nextFiles);
        setFiles(nextFiles);
        if (html) {
          setLatestGame((previousGame) => ({ title: previousGame?.title ?? "Edited Game", html }));
        }

        return { created: true, file: summarizeMorphusFile(nextFile) };
      },
      morphusListFiles: () => ({
        count: files.length,
        files: files.map(summarizeMorphusFile)
      }),
      morphusSearchFiles: (query: string, options?: MorphusSearchFilesOptions) => {
        const pattern = buildMorphusSearchPattern(query, options?.useRegex);
        const maxResults = clampMorphusSearchResults(options?.maxResults);
        const pathFilter = options?.pathGlob?.trim().toLowerCase();
        const matches: Array<{
          endLine?: number;
          line?: number;
          path: string;
          score: number;
          snippet: string;
          startLine?: number;
          type: "content" | "path";
        }> = [];

        for (const file of files) {
          if (matches.length >= maxResults) {
            break;
          }

          const normalizedPath = normalizeMorphusPath(file.path);
          const lowerPath = normalizedPath.toLowerCase();
          if (pathFilter && !lowerPath.includes(pathFilter)) {
            continue;
          }

          const pathMatch = pattern.exec(normalizedPath);
          if (pathMatch) {
            matches.push({
              path: normalizedPath,
              score: 2,
              snippet: normalizedPath,
              type: "path"
            });
          }

          if (matches.length >= maxResults || (isMorphusAssetFile(file) && !options?.includeAssets)) {
            continue;
          }

          const lines = file.content.split(/\r?\n/);
          for (let index = 0; index < lines.length && matches.length < maxResults; index += 1) {
            pattern.lastIndex = 0;
            const match = pattern.exec(lines[index]);
            if (!match) {
              continue;
            }

            const line = index + 1;
            matches.push({
              endLine: Math.min(lines.length, line + 4),
              line,
              path: normalizedPath,
              score: 1,
              snippet: createMorphusSearchSnippet(lines[index], match.index, match[0]?.length ?? 1),
              startLine: Math.max(1, line - 4),
              type: "content"
            });
          }
        }

        return {
          count: matches.length,
          maxResults,
          matches,
          query,
          useRegex: Boolean(options?.useRegex)
        };
      },
      morphusReadFile: (path: string, options?: MorphusReadFileOptions) => {
        const normalizedPath = normalizeMorphusPath(path);
        const file = files.find((entry) => entry.path === normalizedPath);
        if (!file) {
          throw new Error(`File not found: ${normalizedPath}`);
        }

        const slice = sliceMorphusContent(file.content, options);

        return {
          content: slice.content,
          endLine: slice.endLine,
          file: summarizeMorphusFile(file),
          lineSliced: slice.lineSliced,
          maxChars: slice.maxChars,
          startLine: slice.startLine,
          totalLines: slice.totalLines,
          totalSize: slice.totalSize,
          truncated: slice.truncated
        };
      },
      morphusRequestDeleteFile: (path: string, reason: string) => {
        const normalizedPath = normalizeMorphusPath(path);
        const file = files.find((entry) => entry.path === normalizedPath);
        if (!file) {
          throw new Error(`File not found: ${normalizedPath}`);
        }

        return {
          action: "delete_file",
          approvalRequired: true,
          file: summarizeMorphusFile(file),
          message: `Ask the user before deleting ${normalizedPath}.`,
          reason
        };
      },
      morphusRequestRenameFile: (fromPath: string, toPath: string, reason: string) => {
        const normalizedFromPath = normalizeMorphusPath(fromPath);
        const normalizedToPath = normalizeMorphusPath(toPath);
        const file = files.find((entry) => entry.path === normalizedFromPath);
        if (!file) {
          throw new Error(`File not found: ${normalizedFromPath}`);
        }
        if (!normalizedToPath) {
          throw new Error("Destination path is required.");
        }
        if (files.some((entry) => entry.path === normalizedToPath)) {
          throw new Error(`Destination already exists: ${normalizedToPath}`);
        }

        return {
          action: "rename_file",
          approvalRequired: true,
          fromPath: normalizedFromPath,
          message: `Ask the user before renaming ${normalizedFromPath} to ${normalizedToPath}.`,
          reason,
          toPath: normalizedToPath
        };
      },
      morphusWriteFile: (path: string, content: string) => {
        const normalizedPath = normalizeMorphusPath(path);
        const existingFile = files.find((file) => file.path === normalizedPath);
        if (!existingFile) {
          throw new Error(`File not found: ${normalizedPath}`);
        }

        const nextFile: MorphusFileRecord = {
          ...existingFile,
          content,
          language: inferMorphusFileLanguage(normalizedPath),
          updatedAt: Date.now()
        };
        const nextFiles = ensureMorphusAudioIntegration(mergeMorphusFiles(files, [nextFile]));
        const html = buildMorphusPreviewHtml(nextFiles);
        setFiles(nextFiles);
        if (html) {
          setLatestGame((previousGame) => ({ title: previousGame?.title ?? "Edited Game", html }));
        }

        return { file: summarizeMorphusFile(nextFile), updated: true };
      },
      onGeneratedGame: (title: string, html: string, generatedFiles?: Array<{ content: string; path: string }>) => {
        const toolFiles = generatedFiles?.map((file) => ({
          content: file.content,
          language: inferMorphusFileLanguage(file.path),
          path: normalizeMorphusPath(file.path),
          updatedAt: Date.now()
        })) ?? [];
        const mergedFiles = mode === "morphus" ? ensureMorphusAudioIntegration(mergeMorphusFiles(files, toolFiles)) : toolFiles;
        const toolHtml = mode === "morphus" && mergedFiles.length > 0
          ? buildMorphusPreviewHtml(mergedFiles)
          : null;
        const resolvedHtml = toolHtml || html.trim();

        if (resolvedHtml) {
          const game = { title, html: resolvedHtml };
          setLatestGame(game);
          if (mode === "morphus") {
            setFiles(mergedFiles.length > 0 ? mergedFiles : createMorphusFilesFromGame(game));
          }
        }
        pendingGameTitleRef.current = title;
      }
    }),
    [files, mode, toolContext]
  );

  useEffect(() => {
    const check = () => {
      setConfigured(isCopilotConfigured());
      void setupSpeechEngine().catch((err) => console.error(err));
    };

    window.addEventListener("focus", check);
    window.addEventListener("storage", check);

    void setupSpeechEngine().catch((err) => console.error(err));

    return () => {
      window.removeEventListener("focus", check);
      window.removeEventListener("storage", check);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    void loadMorphusMemory(memoryKey).then((memory) => {
      if (cancelled) {
        return;
      }

      if (memory.session) {
        setSession(memory.session);
      }
      if (mode === "morphus" && memory.latestGame) {
        setLatestGame(memory.latestGame);
      }
      if (mode === "morphus") {
        setFiles(ensureMorphusAudioIntegration(memory.files));
      }
      memoryLoadedRef.current = true;
    });

    return () => {
      cancelled = true;
    };
  }, [memoryKey, mode]);

  useEffect(() => {
    if (!memoryLoadedRef.current) {
      return;
    }

    void saveMorphusMemory({
      files: mode === "morphus" ? files : [],
      latestGame: mode === "morphus" ? latestGame : null,
      session,
      updatedAt: Date.now()
    }, memoryKey);
  }, [files, latestGame, memoryKey, mode, session]);

  useEffect(() => {
    if (mode !== "morphus" || files.length === 0) {
      return;
    }

    void exportMorphusFilesToWorkspace(files).catch((error) => {
      console.error("[MORPHUS] Workspace export failed:", error);
    });
  }, [files, mode]);

  useEffect(() => {
    if (session.status !== "idle" || !pendingGameTitleRef.current) {
      return;
    }

    const title = pendingGameTitleRef.current;
    pendingGameTitleRef.current = null;

    const latestAssistantMessage = findLatestAssistantContent(session.messages);
    const morphusFiles =
      mode === "morphus" && latestAssistantMessage
        ? createMorphusFilesFromAssistantContent(latestAssistantMessage)
        : [];
    const html = mode === "morphus"
      ? buildMorphusPreviewHtml(morphusFiles)
      : extractHtmlFromMessages(session.messages);

    if (html) {
      const game = { title, html };
      setLatestGame(game);
      if (mode === "morphus") {
        setFiles((previousFiles) => {
          const mergedFiles = ensureMorphusAudioIntegration(mergeMorphusFiles(previousFiles, morphusFiles));
          return mergedFiles.length > 0 ? mergedFiles : createMorphusFilesFromGame(game);
        });
      }
    }
  }, [mode, session.status, session.messages]);

  useEffect(() => {
    if (mode !== "morphus" || session.status !== "idle" || (files.length > 0 && latestGame)) {
      return;
    }

    const latestAssistantMessage = findLatestAssistantContent(session.messages);
    if (!latestAssistantMessage) {
      return;
    }

    const morphusFiles = createMorphusFilesFromAssistantContent(latestAssistantMessage);
    const html = buildMorphusPreviewHtml(morphusFiles);
    if (!html) {
      return;
    }

    setFiles((previousFiles) => {
      const mergedFiles = ensureMorphusAudioIntegration(mergeMorphusFiles(previousFiles, morphusFiles));
      return mergedFiles.length > 0 ? mergedFiles : createMorphusFilesFromGame({ title: "Generated Game", html });
    });
    setLatestGame((previousGame) => previousGame ?? { title: "Generated Game", html });
  }, [files.length, latestGame, mode, session.status, session.messages]);

  const sendMessage = useCallback(
    async (prompt: string, images?: CopilotImageAttachment[]) => {
      if (abortRef.current || session.status === "thinking" || session.status === "executing") {
        return;
      }

      const settings = loadCopilotSettings();

      if (!isCopilotConfigured(settings)) {
        setSession((previous) => ({
          ...previous,
          status: "error",
          error:
            settings.provider === "codex"
              ? 'Codex not configured. Run "codex login" in your terminal.'
              : "No API key configured. Open Copilot settings to add one."
        }));
        return;
      }

      const controller = new AbortController();
      abortRef.current = controller;

      const [
        {
          runAgenticLoop,
          createCopilotProvider,
          buildEditorSystemPrompt,
          buildMorphusSystemPrompt,
          EDITOR_COPILOT_TOOL_DECLARATIONS,
          GAME_TOOL_DECLARATIONS,
          executeTool
        },
        skillContext
      ] = await Promise.all([loadCopilotRuntime(), discoverCopilotSkills(prompt)]);

      const copilotProvider = createCopilotProvider(settings.provider);
      const baseSystemPrompt =
        mode === "morphus" ? buildMorphusSystemPrompt() : buildEditorSystemPrompt(editor);
      const audioContext =
        mode === "morphus"
          ? `\n\n## Runtime Context\n- ElevenLabs audio is ${settings.elevenlabsApiKey ? "available" : "not configured"} in this browser.\n- Existing Morphus audio files: ${
            availableMorphusAudioFiles.length > 0
              ? availableMorphusAudioFiles.slice(0, 24).join(", ")
              : "none"
          }.\n- Existing Morphus image files: ${
            availableMorphusImageFiles.length > 0
              ? availableMorphusImageFiles.slice(0, 24).join(", ")
              : "none"
          }.\n- Existing Morphus project files: ${
            availableMorphusFilePaths.length > 0
              ? availableMorphusFilePaths.slice(0, 40).join(", ")
              : "none"
          }.\n- Reuse and edit the existing project files by default. On continue or follow-up requests, change only the files that need changes.\n- Reuse existing workspace audio by default. Only ask for new audio if the user explicitly requests it or a required sound category is missing.`
          : "";
      const systemPrompt = appendSkillContextToPrompt(`${baseSystemPrompt}${audioContext}`, skillContext);
      const modeLabel = mode === "morphus" ? "morphus" : "editor";
      const tools = mode === "morphus" ? GAME_TOOL_DECLARATIONS : EDITOR_COPILOT_TOOL_DECLARATIONS;
      const runToolContext = mode === "morphus"
        ? createBudgetedMorphusToolContext(mergedToolContext)
        : mergedToolContext;

      console.log(
        `[COPILOT] Mode: ${mode === "morphus" ? "morphus (1 tool)" : `editor (${tools.length} tools)`}`
      );

      const providerConfig = {
        apiKey: settings.provider === "gemini" ? settings.geminiApiKey || "" : "",
        model: settings.provider === "gemini" ? settings.gemini.model : settings.codex.model,
        temperature: settings.temperature
      };

      if (copilotProvider.kind === "session-based") {
        await copilotProvider.provider.runSession({
          messages: session.messages,
          activity: session.activity,
          userPrompt: prompt,
          tools,
          systemPrompt,
          providerConfig,
          providerId: settings.provider,
          modeLabel,
          skillContext,
          threadId: codexThreadIdRef.current,
          onThreadId: (threadId) => {
            codexThreadIdRef.current = threadId;
          },
          executeTool: (toolCall) => executeTool(editor, toolCall, runToolContext),
          onUpdate: publishSession,
          signal: controller.signal
        });
      } else {
        await runAgenticLoop(
          prompt,
          session.messages,
          {
            provider: copilotProvider.provider,
            providerConfig,
            providerId: settings.provider,
            modeLabel,
            skillContext,
            existingActivity: session.activity,
            systemPrompt,
            tools,
            executeTool: (toolCall) => executeTool(editor, toolCall, runToolContext),
            onUpdate: publishSession
          },
          controller.signal,
          images
        );
      }

      abortRef.current = null;
    },
    [availableMorphusAudioFiles, availableMorphusFilePaths, availableMorphusImageFiles, editor, mergedToolContext, mode, publishSession, session.activity, session.messages]
  );

  const abort = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const clearHistory = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    codexThreadIdRef.current = undefined;
    pendingGameTitleRef.current = null;
    setSession(EMPTY_SESSION);
    if (mode === "morphus") {
      setFiles([]);
      setLatestGame(null);
    }
    void saveMorphusMemory({
      files: [],
      latestGame: null,
      session: EMPTY_SESSION,
      updatedAt: Date.now()
    }, memoryKey);
  }, [memoryKey, mode]);

  const clearLatestGame = useCallback(() => setLatestGame(null), []);

  const saveFile = useCallback((path: string, content: string) => {
    setFiles((previous) => {
      const now = Date.now();
      const nextFiles = previous.some((file) => file.path === path)
        ? previous.map((file) => (file.path === path ? { ...file, content, updatedAt: now } : file))
        : [
            ...previous,
            {
              content,
              language: inferMorphusFileLanguage(path),
              path,
              updatedAt: now
            }
          ];
      const ensuredFiles = ensureMorphusAudioIntegration(nextFiles);

      const html = buildMorphusPreviewHtml(ensuredFiles);
      if (html) {
        setLatestGame((previousGame) =>
          previousGame ? { ...previousGame, html } : { title: "Edited Game", html }
        );
      }

      return ensuredFiles;
    });
  }, []);

  return {
    session,
    sendMessage,
    abort,
    clearHistory,
    isConfigured: configured,
    refreshConfigured: () => setConfigured(isCopilotConfigured()),
    latestGame,
    clearLatestGame,
    files,
    saveFile
  };
}

function findLatestAssistantContent(messages: CopilotSession["messages"]) {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role === "assistant" && message.content.trim()) {
      return message.content;
    }
  }

  return "";
}
