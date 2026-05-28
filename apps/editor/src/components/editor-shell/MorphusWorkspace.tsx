import { Check, ChevronRight, Code2, Download, Edit3, ExternalLink, FileCode2, Folder, FolderOpen, FolderUp, LayoutPanelLeft, Loader2, MessageSquareText, Music2, Upload, Volume2, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type InputHTMLAttributes, type ReactNode } from "react";
import { buildGameBlobUrl } from "@/lib/game-html";
import type { CopilotImageAttachment, CopilotSession } from "@/lib/copilot/types";
import { generateMusicDataUrl, generateSoundEffectDataUrl } from "@/lib/elevenlabs-client";
import { loadCopilotSettings } from "@/lib/copilot/settings";
import { extractMorphusAudioRequests, type MorphusAudioRequest, type MorphusFileRecord } from "@/lib/copilot/morphus-memory";
import { CopilotPanel } from "@/components/editor-shell/CopilotPanel";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { RagIngestionUI } from "@/components/morphus-rag/RagIngestionUI";

type MorphusWorkspaceProps = {
  files: MorphusFileRecord[];
  isConfigured: boolean;
  latestGame: { title: string; html: string } | null;
  onAbort: () => void;
  onClearGame: () => void;
  onClearHistory: () => void;
  onClose: () => void;
  onPlayInViewport?: () => void;
  onSaveFile: (path: string, content: string) => void;
  onSendMessage: (prompt: string, images?: CopilotImageAttachment[]) => void;
  onSettingsChanged: () => void;
  session: CopilotSession;
};

export function MorphusWorkspace({
  files,
  isConfigured,
  latestGame,
  onAbort,
  onClearGame,
  onClearHistory,
  onClose,
  onPlayInViewport,
  onSaveFile,
  onSendMessage,
  onSettingsChanged,
  session
}: MorphusWorkspaceProps) {
  const [activePath, setActivePath] = useState("");
  const [draftContent, setDraftContent] = useState("");
  const [editingPath, setEditingPath] = useState("");
  const [audioError, setAudioError] = useState("");
  const [exportError, setExportError] = useState("");
  const [exportingZip, setExportingZip] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<string[]>([]);
  const [generatingAudioPaths, setGeneratingAudioPaths] = useState<string[]>([]);
  const [mobileTab, setMobileTab] = useState<"files" | "code" | "chat">("chat");
  const [rejectedAudioPaths, setRejectedAudioPaths] = useState<string[]>([]);
  const [requestStarted, setRequestStarted] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const hasConversation = session.messages.length > 0 || session.activity.length > 0;
  const workspaceActive = requestStarted || hasConversation || files.length > 0 || Boolean(latestGame);
  const activeFile = files.find((file) => file.path === activePath) ?? files[0];
  const activeFileIsAudio = Boolean(activeFile && isPlayableAudioFile(activeFile));
  const codeLanguage = activeFile ? inferEditorLanguage(activeFile.path) : "text";
  const fileTree = useMemo(() => buildMorphusFileTree(files), [files]);
  const elevenLabsAvailable = Boolean(loadCopilotSettings().elevenlabsApiKey);
  const audioRequests = useMemo(() => {
    const existingPaths = new Set(files.map((file) => file.path.toLowerCase()));
    const rejectedPaths = new Set(rejectedAudioPaths.map((path) => path.toLowerCase()));

    return session.messages
      .filter((message) => message.role === "assistant" && message.content)
      .flatMap((message) => extractMorphusAudioRequests(message.content))
      .filter(
        (request) =>
          !existingPaths.has(request.path.toLowerCase()) &&
          !rejectedPaths.has(request.path.toLowerCase())
        );
  }, [files, rejectedAudioPaths, session.messages]);
  const hasPendingAudioApproval = audioRequests.length > 0 || generatingAudioPaths.length > 0;
  const playableGame = hasPendingAudioApproval ? null : latestGame;
  const folderPaths = useMemo(() => collectMorphusFolderPaths(files), [files]);
  const allFoldersExpanded = folderPaths.length > 0 && folderPaths.every((path) => expandedFolders.includes(path));

  useEffect(() => {
    if (files.length === 0) {
      setActivePath("");
      setExpandedFolders([]);
      return;
    }

    if (!files.some((file) => file.path === activePath)) {
      setActivePath(files[0].path);
    }
  }, [activePath, files]);

  useEffect(() => {
    setExpandedFolders((previous) => {
      const next = new Set(previous);

      for (const file of files) {
        const parts = file.path.split("/");
        let folderPath = "";
        for (let i = 0; i < parts.length - 1; i += 1) {
          folderPath = folderPath ? `${folderPath}/${parts[i]}` : parts[i];
          next.add(folderPath);
        }
      }

      return Array.from(next);
    });
  }, [files]);

  useEffect(() => {
    if (!activeFile || editingPath !== activeFile.path) {
      return;
    }

    setDraftContent(activeFile.content);
  }, [activeFile, editingPath]);

  const openGame = () => {
    if (!playableGame) {
      return;
    }

    window.open(buildGameBlobUrl(playableGame.html), "_blank");
  };

  const sendMorphusMessage = (prompt: string, images?: CopilotImageAttachment[]) => {
    setRequestStarted(true);

    if (images?.length) {
      const existingPaths = files.map((file) => file.path);
      images.forEach((image, index) => {
        const assetPath = buildMorphusImageAssetPath(existingPaths, image, index);
        existingPaths.push(assetPath);
        onSaveFile(assetPath, image.dataUrl);
      });
    }

    onSendMessage(prompt, images);
  };

  const handleImportChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const importedFiles = Array.from(event.target.files ?? []);
    event.target.value = "";

    for (const file of importedFiles) {
      const path = getImportPath(file);
      const content = await readImportedFile(file);
      onSaveFile(path, content);
      setActivePath(path);
      setMobileTab("code");
    }
  };

  const clearMorphusHistory = () => {
    setRequestStarted(false);
    setActivePath("");
    setAudioError("");
    setExportError("");
    setEditingPath("");
    setExpandedFolders([]);
    setDraftContent("");
    setRejectedAudioPaths([]);
    onClearHistory();
  };

  const startEditing = () => {
    if (!activeFile) {
      return;
    }

    setEditingPath(activeFile.path);
    setDraftContent(activeFile.content);
  };

  const cancelEditing = () => {
    setEditingPath("");
    setDraftContent("");
  };

  const saveEditing = () => {
    if (!activeFile || editingPath !== activeFile.path) {
      return;
    }

    onSaveFile(activeFile.path, draftContent);
    setEditingPath("");
    setDraftContent("");
  };

  const approveAudioRequest = async (request: MorphusAudioRequest) => {
    setAudioError("");
    setGeneratingAudioPaths((previous) => [...previous, request.path]);

    try {
      const dataUrl = request.kind === "music"
        ? await generateMusicDataUrl(request.description, request.durationSeconds)
        : await generateSoundEffectDataUrl(request.description, request.durationSeconds);
      onSaveFile(request.path, dataUrl);
      setActivePath(request.path);
      setMobileTab("code");
    } catch (error) {
      setAudioError(error instanceof Error ? error.message : "Could not generate audio.");
    } finally {
      setGeneratingAudioPaths((previous) => previous.filter((path) => path !== request.path));
    }
  };

  const rejectAudioRequest = (request: MorphusAudioRequest) => {
    setRejectedAudioPaths((previous) => [...previous, request.path]);
  };

  const toggleFolder = (path: string) => {
    setExpandedFolders((previous) =>
      previous.includes(path)
        ? previous.filter((entry) => entry !== path)
        : [...previous, path]
    );
  };

  const toggleAllFolders = () => {
    setExpandedFolders((previous) => {
      if (folderPaths.length === 0) {
        return previous;
      }

      return allFoldersExpanded ? [] : folderPaths;
    });
  };

  const exportFilesAsZip = async () => {
    if (files.length === 0 || exportingZip) {
      return;
    }

    setExportError("");
    setExportingZip(true);

    try {
      const { zipSync } = await import("fflate");
      const entries = Object.fromEntries(
        files.map((file) => [file.path, encodeMorphusFile(file)])
      );
      const zip = zipSync(entries, { level: 6 });
      downloadBinaryFile(`${slugifyFilename(playableGame?.title || latestGame?.title || "morphus-project")}.zip`, zip, "application/zip");
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Could not export ZIP.");
    } finally {
      setExportingZip(false);
    }
  };

  const editingActiveFile = Boolean(activeFile && editingPath === activeFile.path);
  const importButtons = (
    <div className="flex items-center gap-1">
      <button
        className="flex size-7 items-center justify-center rounded-lg text-white/34 transition-colors hover:bg-white/[0.05] hover:text-white/76"
        onClick={() => fileInputRef.current?.click()}
        title="Import files"
        type="button"
      >
        <Upload className="size-3.5" />
      </button>
      <button
        className="flex size-7 items-center justify-center rounded-lg text-white/34 transition-colors hover:bg-white/[0.05] hover:text-white/76"
        onClick={() => folderInputRef.current?.click()}
        title="Import folder"
        type="button"
      >
        <FolderUp className="size-3.5" />
      </button>
      <button
        className="hidden size-7 items-center justify-center rounded-lg text-white/34 transition-colors hover:bg-white/[0.05] hover:text-white/76 md:flex"
        onClick={toggleAllFolders}
        title={allFoldersExpanded ? "Collapse folders" : "Expand folders"}
        type="button"
      >
        <LayoutPanelLeft className="size-3.5" />
      </button>
    </div>
  );
  const fileList = (
    <>
      <div className="flex-1 overflow-y-auto py-2">
        {files.length === 0 ? (
          <div className="px-3 py-4 text-[11px] leading-relaxed text-white/34">
            Import assets or ask Morphus to generate a game. Files will appear here.
          </div>
        ) : null}
        {fileTree.map((node) => (
          <MorphusFileTreeNode
            activePath={activeFile?.path ?? ""}
            expandedFolders={expandedFolders}
            key={node.path}
            node={node}
            onSelectFile={(path) => {
              setActivePath(path);
              setMobileTab("code");
            }}
            onToggleFolder={toggleFolder}
          />
        ))}
      </div>
      <div className="border-t border-white/8 p-3 text-[10px] leading-relaxed text-white/34">
        Chat memory and generated files are saved locally in IndexedDB.
      </div>
    </>
  );
  const codePane = (
    <div className="h-full min-h-0 min-w-0 overflow-hidden border-white/8 md:border-r">
      <div className="flex h-9 items-center gap-2 border-b border-white/8 bg-[#191e25] px-3 text-[11px] text-white/52">
        <FileCode2 className="size-3.5 shrink-0 text-cyan-300/70" />
        <span className="min-w-0 flex-1 truncate">{activeFile?.path ?? "No file selected"}</span>
        {activeFile && activeFile.language !== "asset" && (
          <div className="flex items-center gap-1">
            {editingActiveFile ? (
              <>
                <Button
                  className="editor-toolbar-button h-7 rounded-[9px] px-2 text-[10px]"
                  onClick={cancelEditing}
                  size="sm"
                  variant="ghost"
                >
                  <X className="size-3" />
                  Cancel
                </Button>
                <Button
                  className="h-7 rounded-[9px] border border-emerald-400/20 bg-emerald-500/20 px-2 text-[10px] font-medium text-emerald-200 hover:bg-emerald-500/30"
                  onClick={saveEditing}
                  size="sm"
                  variant="ghost"
                >
                  <Check className="size-3" />
                  Save
                </Button>
              </>
            ) : (
              <Button
                className="editor-toolbar-button h-7 rounded-[9px] px-2 text-[10px]"
                onClick={startEditing}
                size="sm"
                variant="ghost"
              >
                <Edit3 className="size-3" />
                Edit
              </Button>
            )}
          </div>
        )}
      </div>
      {activeFile ? (
        activeFile.language === "asset" && activeFileIsAudio ? (
          <div className="flex h-full items-center justify-center bg-[#171a1f] px-6">
            <div className="w-full max-w-md rounded-3xl border border-white/10 bg-white/[0.03] p-6 text-center shadow-[0_22px_80px_rgba(0,0,0,0.28)]">
              <div className="mx-auto flex size-14 items-center justify-center rounded-2xl border border-emerald-300/16 bg-emerald-500/10 text-emerald-200">
                <Volume2 className="size-5" />
              </div>
              <div className="mt-4 text-[11px] font-semibold tracking-[0.18em] text-white/72 uppercase">
                Audio asset
              </div>
              <p className="mt-2 break-all text-[11px] leading-relaxed text-white/40">{activeFile.path}</p>
              <audio
                className="mt-5 w-full"
                controls
                preload="metadata"
                src={resolveAudioSource(activeFile)}
              />
              <p className="mt-3 text-[11px] leading-relaxed text-white/34">
                Preview the exact clip that will be referenced by the generated game.
              </p>
            </div>
          </div>
        ) : activeFile.language === "asset" ? (
          <div className="flex h-full items-center justify-center bg-[#171a1f] px-6 text-center">
            <div className="max-w-md">
              <div className="mx-auto flex size-12 items-center justify-center rounded-xl border border-[#f6d07d]/20 bg-[#f6d07d]/10 text-[#f6d07d]">
                <FileCode2 className="size-5" />
              </div>
              <div className="mt-4 text-[11px] font-semibold tracking-[0.18em] text-white/72 uppercase">
                Asset imported
              </div>
              <p className="mt-2 break-all text-[11px] leading-relaxed text-white/38">{activeFile.path}</p>
              <p className="mt-3 text-[11px] leading-relaxed text-white/34">
                Binary assets are stored locally as data URLs and can be referenced by generated HTML, CSS, or JavaScript.
              </p>
            </div>
          </div>
        ) : editingActiveFile ? (
          <MorphusCodeEditor
            language={codeLanguage}
            onChange={setDraftContent}
            value={draftContent}
          />
        ) : (
          <MorphusCodeViewer
            language={codeLanguage}
            value={activeFile.content}
          />
        )
      ) : (
        <div className="flex h-full items-center justify-center bg-[#171a1f] px-6 text-center">
          <div className="max-w-xs">
            <div className="mx-auto flex size-10 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-cyan-200/70">
              <FileCode2 className="size-4" />
            </div>
            <div className="mt-4 text-[11px] font-semibold tracking-[0.18em] text-white/62 uppercase">
              Waiting for files
            </div>
            <p className="mt-2 text-[11px] leading-relaxed text-white/36">
              Morphus will place generated HTML, JavaScript, CSS, and imported assets here.
            </p>
          </div>
        </div>
      )}
    </div>
  );
  const chatPane = (
    <div className="flex h-full min-h-0 flex-col gap-2 bg-[#0f151a] p-2 md:p-3">
      {audioRequests.length > 0 && (
        <AudioApprovalTray
          available={elevenLabsAvailable}
          error={audioError}
          generatingPaths={generatingAudioPaths}
          onApprove={(request) => {
            void approveAudioRequest(request);
          }}
          onReject={rejectAudioRequest}
          requests={audioRequests}
        />
      )}
      <div className="min-h-0 flex-1">
        <CopilotPanel
          emptyText="Describe the HTML game you want Morphus to create."
          isConfigured={isConfigured}
          latestGame={playableGame}
          onAbort={onAbort}
          onClearGame={onClearGame}
          onClearHistory={clearMorphusHistory}
          onClose={onClose}
          onPlayInViewport={onPlayInViewport}
          onSendMessage={sendMorphusMessage}
          onSettingsChanged={onSettingsChanged}
          placeholder="Create a playable HTML game..."
          session={session}
          title="Morphus"
        />
      </div>
    </div>
  );

  return (
    <div className="absolute inset-0 z-40 flex overflow-hidden rounded-[22px] border border-white/10 bg-[#0b0f14] shadow-[0_30px_90px_rgba(0,0,0,0.48)] md:rounded-[32px]">
      {!workspaceActive ? (
        <MorphusStart
          isConfigured={isConfigured}
          latestGame={latestGame}
          onAbort={onAbort}
          onClearGame={onClearGame}
          onClearHistory={clearMorphusHistory}
          onClose={onClose}
          onPlayInViewport={onPlayInViewport}
          onSendMessage={sendMorphusMessage}
          onSettingsChanged={onSettingsChanged}
          session={session}
        />
      ) : (
        <>
          <input
            className="hidden"
            multiple
            onChange={(event) => {
              void handleImportChange(event);
            }}
            ref={fileInputRef}
            type="file"
          />
          <input
            {...folderInputProps}
            className="hidden"
            multiple
            onChange={(event) => {
              void handleImportChange(event);
            }}
            ref={folderInputRef}
            type="file"
          />
          <aside className="hidden w-56 shrink-0 flex-col border-r border-white/8 bg-[#11161d] md:flex">
        <div className="flex h-12 items-center justify-between border-b border-white/8 px-3">
          <div className="flex items-center gap-2 text-[10px] font-semibold tracking-[0.18em] text-white/44 uppercase">
            <Folder className="size-3.5" />
            Explorer
          </div>
          {importButtons}
        </div>
        {fileList}
      </aside>

      <section className="flex min-w-0 flex-1 flex-col bg-[#15191f]">
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-white/8 bg-[#1b2027] px-4">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-7 items-center justify-center rounded-lg border border-[#f6d07d]/20 bg-[#f6d07d]/10 text-[#f6d07d]">
              <Code2 className="size-3.5" />
            </span>
            <div className="min-w-0">
              <div className="text-[11px] font-semibold tracking-[0.2em] text-white/88 uppercase">
                Morphus
              </div>
              <div className="truncate text-[10px] text-white/38">
                HTML game maker
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {files.length > 0 && (
              <Button
                className="editor-toolbar-button h-8 rounded-[10px] px-2.5 text-[11px]"
                disabled={exportingZip}
                onClick={() => {
                  void exportFilesAsZip();
                }}
                size="sm"
                variant="ghost"
              >
                {exportingZip ? <Loader2 className="size-3.5 animate-spin" /> : <Download className="size-3.5" />}
                Export ZIP
              </Button>
            )}
            {latestGame && (
              <>
                <Button
                  className="editor-toolbar-button h-8 rounded-[10px] px-2.5 text-[11px]"
                  disabled={hasPendingAudioApproval}
                  onClick={openGame}
                  size="sm"
                  variant="ghost"
                >
                  <ExternalLink className="size-3.5" />
                  Open
                </Button>
              </>
            )}
            <Button
              aria-label="Close Morphus"
              className="editor-toolbar-button size-8 rounded-[10px]"
              onClick={onClose}
              size="icon-sm"
              variant="ghost"
            >
              <X className="size-3.5" />
            </Button>
          </div>
        </header>
        {exportError && (
          <div className="border-b border-rose-300/12 bg-rose-500/10 px-4 py-2 text-[11px] text-rose-100/80">
            {exportError}
          </div>
        )}

        <div className="hidden min-h-0 flex-1 grid-cols-[minmax(0,1fr)_22rem] md:grid">
          {codePane}
          {chatPane}
        </div>

        <div className="flex min-h-0 flex-1 flex-col md:hidden">
          <div className="min-h-0 flex-1 overflow-hidden">
            {mobileTab === "files" ? (
              <div className="flex h-full flex-col bg-[#11161d]">
                <div className="flex h-11 items-center justify-between border-b border-white/8 px-3">
                  <div className="flex items-center gap-2 text-[10px] font-semibold tracking-[0.18em] text-white/44 uppercase">
                    <Folder className="size-3.5" />
                    Explorer
                  </div>
                  {importButtons}
                </div>
                {fileList}
              </div>
            ) : mobileTab === "code" ? (
              codePane
            ) : (
              chatPane
            )}
          </div>
          <nav className="grid h-16 shrink-0 grid-cols-3 border-t border-white/8 bg-[#0d1218] px-2 py-2">
            <MorphusTabButton active={mobileTab === "files"} icon={<Folder className="size-4" />} label="Files" onClick={() => setMobileTab("files")} />
            <MorphusTabButton active={mobileTab === "code"} icon={<Code2 className="size-4" />} label="Code" onClick={() => setMobileTab("code")} />
            <MorphusTabButton active={mobileTab === "chat"} icon={<MessageSquareText className="size-4" />} label="Chat" onClick={() => setMobileTab("chat")} />
          </nav>
        </div>
      </section>
        </>
      )}
    </div>
  );
}

type MorphusFileTreeNodeData =
  | {
      children: MorphusFileTreeNodeData[];
      kind: "folder";
      name: string;
      path: string;
    }
  | {
      file: MorphusFileRecord;
      kind: "file";
      name: string;
      path: string;
    };

function MorphusCodeEditor({
  language,
  onChange,
  value
}: {
  language: EditorLanguage;
  onChange: (value: string) => void;
  value: string;
}) {
  const lineCount = Math.max(1, value.split("\n").length);

  return (
    <div className="flex h-full min-h-0 bg-[#14181e] font-mono text-[12px] leading-6 text-slate-100">
      <div className="flex w-14 shrink-0 flex-col items-end overflow-hidden border-r border-white/6 bg-[#10141a] px-2 py-4 text-[11px] text-white/28 md:py-5">
        {Array.from({ length: lineCount }, (_, index) => (
          <div className="h-6" key={index}>
            {index + 1}
          </div>
        ))}
      </div>
      <textarea
        className="h-full w-full resize-none overflow-auto border-0 bg-transparent px-4 py-4 font-mono text-[12px] leading-6 text-slate-100 outline-none selection:bg-emerald-400/20 md:px-6 md:py-5"
        data-language={language}
        onChange={(event) => onChange(event.target.value)}
        spellCheck={false}
        value={value}
        wrap="off"
      />
    </div>
  );
}

function MorphusCodeViewer({
  language,
  value
}: {
  language: EditorLanguage;
  value: string;
}) {
  const lines = value.split("\n");

  return (
    <div className="flex h-full min-h-0 bg-[#14181e] font-mono text-[12px] leading-6 text-slate-200">
      <div className="flex w-14 shrink-0 flex-col items-end overflow-hidden border-r border-white/6 bg-[#10141a] px-2 py-4 text-[11px] text-white/28 md:py-5">
        {lines.map((_, index) => (
          <div className="h-6" key={index}>
            {index + 1}
          </div>
        ))}
      </div>
      <pre className="h-full min-w-0 flex-1 overflow-auto bg-transparent px-4 py-4 md:px-6 md:py-5">
        <code>
          {lines.map((line, index) => (
            <div className="min-h-6 whitespace-pre" key={index}>
              {renderHighlightedLine(line, language)}
            </div>
          ))}
        </code>
      </pre>
    </div>
  );
}

function MorphusFileTreeNode({
  activePath,
  depth = 0,
  expandedFolders,
  node,
  onSelectFile,
  onToggleFolder
}: {
  activePath: string;
  depth?: number;
  expandedFolders: string[];
  node: MorphusFileTreeNodeData;
  onSelectFile: (path: string) => void;
  onToggleFolder: (path: string) => void;
}) {
  if (node.kind === "folder") {
    const expanded = expandedFolders.includes(node.path);

    return (
      <div>
        <button
          className="flex w-full items-center gap-1.5 border-l-2 border-transparent py-1.5 pr-3 text-left text-[12px] font-semibold text-white/58 transition-colors hover:bg-white/[0.035] hover:text-white/82"
          onClick={() => onToggleFolder(node.path)}
          style={{ paddingLeft: `${12 + depth * 12}px` }}
          type="button"
        >
          <ChevronRight className={cn("size-3 text-white/32 transition-transform", expanded && "rotate-90")} />
          {expanded ? <FolderOpen className="size-3.5 text-[#f6d07d]/72" /> : <Folder className="size-3.5 text-[#f6d07d]/60" />}
          <span className="truncate">{node.name}</span>
        </button>
        {expanded && node.children.map((child) => (
          <MorphusFileTreeNode
            activePath={activePath}
            depth={depth + 1}
            expandedFolders={expandedFolders}
            key={child.path}
            node={child}
            onSelectFile={onSelectFile}
            onToggleFolder={onToggleFolder}
          />
        ))}
      </div>
    );
  }

  return (
    <button
      className={cn(
        "flex w-full items-center gap-2 border-l-2 py-2 pr-3 text-left text-[12px] transition-colors",
        activePath === node.path
          ? "border-[#f6d07d] bg-white/[0.06] text-white"
          : "border-transparent text-white/58 hover:bg-white/[0.035] hover:text-white/82"
      )}
      onClick={() => onSelectFile(node.path)}
      style={{ paddingLeft: `${28 + depth * 12}px` }}
      type="button"
    >
      <FileCode2 className="size-3.5 shrink-0 text-cyan-300/72" />
      <span className="truncate font-medium">{node.name}</span>
    </button>
  );
}

function buildMorphusFileTree(files: MorphusFileRecord[]): MorphusFileTreeNodeData[] {
  const root: MorphusFileTreeNodeData[] = [];
  const folders = new Map<string, Extract<MorphusFileTreeNodeData, { kind: "folder" }>>();

  const getFolder = (name: string, path: string, siblings: MorphusFileTreeNodeData[]) => {
    const existing = folders.get(path);
    if (existing) {
      return existing;
    }

    const folder: Extract<MorphusFileTreeNodeData, { kind: "folder" }> = {
      children: [],
      kind: "folder",
      name,
      path
    };
    folders.set(path, folder);
    siblings.push(folder);
    return folder;
  };

  for (const file of files) {
    const parts = file.path.split("/").filter(Boolean);
    let siblings = root;
    let folderPath = "";

    for (let i = 0; i < parts.length; i += 1) {
      const part = parts[i];
      const isFile = i === parts.length - 1;
      const nextPath = folderPath ? `${folderPath}/${part}` : part;

      if (isFile) {
        siblings.push({
          file,
          kind: "file",
          name: part,
          path: file.path
        });
      } else {
        const folder = getFolder(part, nextPath, siblings);
        siblings = folder.children;
        folderPath = nextPath;
      }
    }
  }

  return sortMorphusFileTree(root);
}

function collectMorphusFolderPaths(files: MorphusFileRecord[]) {
  const folderPaths = new Set<string>();

  for (const file of files) {
    const parts = file.path.split("/").filter(Boolean);
    let folderPath = "";

    for (let i = 0; i < parts.length - 1; i += 1) {
      folderPath = folderPath ? `${folderPath}/${parts[i]}` : parts[i];
      folderPaths.add(folderPath);
    }
  }

  return Array.from(folderPaths).sort((a, b) => a.localeCompare(b));
}

function sortMorphusFileTree(nodes: MorphusFileTreeNodeData[]): MorphusFileTreeNodeData[] {
  return nodes
    .map((node) => node.kind === "folder" ? { ...node, children: sortMorphusFileTree(node.children) } : node)
    .sort((a, b) => {
      if (a.kind !== b.kind) {
        return a.kind === "folder" ? -1 : 1;
      }

      return a.name.localeCompare(b.name);
    });
}

type EditorLanguage = "css" | "html" | "javascript" | "json" | "text";

function inferEditorLanguage(path: string): EditorLanguage {
  const lower = path.toLowerCase();
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "html";
  if (lower.endsWith(".css")) return "css";
  if (lower.endsWith(".js") || lower.endsWith(".mjs") || lower.endsWith(".ts") || lower.endsWith(".tsx") || lower.endsWith(".jsx")) return "javascript";
  if (lower.endsWith(".json")) return "json";
  return "text";
}

function renderHighlightedLine(line: string, language: EditorLanguage) {
  if (!line) {
    return <span>&nbsp;</span>;
  }

  const tokens = tokenizeCodeLine(line, language);
  return tokens.map((token, index) => (
    <span className={codeTokenClassName(token.kind)} key={`${index}:${token.value}`}>
      {token.value}
    </span>
  ));
}

function tokenizeCodeLine(line: string, language: EditorLanguage) {
  const pattern = /(\"(?:\\.|[^"])*\"|'(?:\\.|[^'])*'|`(?:\\.|[^`])*`|\/\/.*$|\/\*.*?\*\/|<!--.*?-->|<\/?[A-Za-z][^>\s/]*|[{}()[\];,.<>/=:+\-*]|-?\b\d+(?:\.\d+)?\b|\b(?:class|const|constructor|else|export|extends|false|function|if|import|let|new|null|return|super|this|true|var|while)\b)/gm;
  const tokens: Array<{ kind: "comment" | "keyword" | "number" | "operator" | "string" | "tag" | "text"; value: string }> = [];
  let lastIndex = 0;

  for (const match of line.matchAll(pattern)) {
    const value = match[0];
    const index = match.index ?? 0;
    if (index > lastIndex) {
      tokens.push({ kind: "text", value: line.slice(lastIndex, index) });
    }

    let kind: "comment" | "keyword" | "number" | "operator" | "string" | "tag" | "text" = "text";
    if (/^(\/\/|\/\*|<!--)/.test(value)) kind = "comment";
    else if (/^["'`]/.test(value)) kind = "string";
    else if (/^-?\d/.test(value)) kind = "number";
    else if (/^[{}()[\];,.<>/=:+\-*]+$/.test(value)) kind = "operator";
    else if (language === "html" && /^<\/?[A-Za-z]/.test(value)) kind = "tag";
    else if (/^(class|const|constructor|else|export|extends|false|function|if|import|let|new|null|return|super|this|true|var|while)$/.test(value)) kind = "keyword";

    tokens.push({ kind, value });
    lastIndex = index + value.length;
  }

  if (lastIndex < line.length) {
    tokens.push({ kind: "text", value: line.slice(lastIndex) });
  }

  return tokens;
}

function codeTokenClassName(kind: "comment" | "keyword" | "number" | "operator" | "string" | "tag" | "text") {
  switch (kind) {
    case "comment":
      return "text-[#66778d]";
    case "keyword":
      return "text-[#ffb86c]";
    case "number":
      return "text-[#7dd3fc]";
    case "operator":
      return "text-[#f8fafc]";
    case "string":
      return "text-[#a3e635]";
    case "tag":
      return "text-[#5eead4]";
    default:
      return "text-slate-200";
  }
}

function MorphusTabButton({
  active,
  icon,
  label,
  onClick
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      className={cn(
        "mx-1 flex flex-col items-center justify-center gap-1 rounded-xl text-[10px] font-medium transition-colors",
        active
          ? "border border-[#f6d07d]/20 bg-[#f6d07d]/10 text-[#f6d07d] shadow-[0_0_22px_rgba(246,208,125,0.08)]"
          : "text-white/42 hover:bg-white/[0.04] hover:text-white/76"
      )}
      onClick={onClick}
      type="button"
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function AudioApprovalTray({
  available,
  error,
  generatingPaths,
  onApprove,
  onReject,
  requests
}: {
  available: boolean;
  error: string;
  generatingPaths: string[];
  onApprove: (request: MorphusAudioRequest) => void;
  onReject: (request: MorphusAudioRequest) => void;
  requests: MorphusAudioRequest[];
}) {
  const busy = generatingPaths.length > 0;

  return (
    <div className="shrink-0 rounded-2xl border border-[#f6d07d]/16 bg-[#f6d07d]/[0.055] p-3 shadow-[0_18px_42px_rgba(0,0,0,0.2)]">
      <div className="flex items-start gap-2">
        <span className="flex size-8 shrink-0 items-center justify-center rounded-xl border border-[#f6d07d]/20 bg-[#f6d07d]/10 text-[#f6d07d]">
          <Music2 className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-semibold tracking-[0.18em] text-[#f6d07d]/88 uppercase">
            Audio approval
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-white/48">
            Morphus requested ElevenLabs audio. Approve only the clips you want generated and saved into the file explorer.
          </p>
          <p className="mt-2 text-[11px] leading-relaxed text-white/40">
            Play access stays locked until every requested clip is approved or skipped.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              className="rounded-lg px-2.5 py-1 text-[10px] font-medium text-white/42 transition-colors hover:bg-white/[0.05] hover:text-white/76 disabled:pointer-events-none disabled:opacity-40"
              disabled={busy}
              onClick={() => requests.forEach(onReject)}
              type="button"
            >
              Skip all
            </button>
            <button
              className="flex items-center gap-1 rounded-lg border border-emerald-300/18 bg-emerald-500/16 px-2.5 py-1 text-[10px] font-medium text-emerald-100 transition-colors hover:bg-emerald-500/24 disabled:pointer-events-none disabled:opacity-45"
              disabled={!available || busy}
              onClick={() => requests.forEach(onApprove)}
              type="button"
            >
              <Check className="size-3" />
              Approve all
            </button>
          </div>
          {!available && (
            <p className="mt-2 rounded-xl border border-amber-300/15 bg-amber-400/10 px-3 py-2 text-[11px] text-amber-100/80">
              Add an ElevenLabs API key in settings before approving audio.
            </p>
          )}
          {error && (
            <p className="mt-2 rounded-xl border border-rose-300/15 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-100/80">
              {error}
            </p>
          )}
          <div className="mt-3 max-h-48 space-y-2 overflow-y-auto pr-1">
            {requests.map((request) => {
              const generating = generatingPaths.includes(request.path);

              return (
                <div
                  className="rounded-xl border border-white/10 bg-black/15 px-3 py-2"
                  key={request.path}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 text-[11px] font-medium text-white/78">
                        {request.kind === "music" ? <Music2 className="size-3 text-cyan-200/70" /> : <Volume2 className="size-3 text-cyan-200/70" />}
                        <span className="truncate">{request.path}</span>
                      </div>
                      <p className="mt-1 text-[10px] leading-relaxed text-white/42">
                        {request.description}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <button
                        className="rounded-lg px-2 py-1 text-[10px] font-medium text-white/38 transition-colors hover:bg-white/[0.05] hover:text-white/72"
                        disabled={generating}
                        onClick={() => onReject(request)}
                        type="button"
                      >
                        Skip
                      </button>
                      <button
                        className="flex items-center gap-1 rounded-lg border border-emerald-300/18 bg-emerald-500/16 px-2 py-1 text-[10px] font-medium text-emerald-100 transition-colors hover:bg-emerald-500/24 disabled:pointer-events-none disabled:opacity-45"
                        disabled={!available || generating}
                        onClick={() => onApprove(request)}
                        type="button"
                      >
                        {generating ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />}
                        Approve
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

const folderInputProps = {
  directory: "",
  webkitdirectory: ""
} as InputHTMLAttributes<HTMLInputElement> & {
  directory: string;
  webkitdirectory: string;
};

function getImportPath(file: File) {
  const maybeRelative = file as File & { webkitRelativePath?: string };
  return (maybeRelative.webkitRelativePath || file.name).replace(/\\/g, "/");
}

function readImportedFile(file: File): Promise<string> {
  if (isTextLikeFile(file)) {
    return file.text();
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.readAsDataURL(file);
  });
}

function isTextLikeFile(file: File) {
  const lower = file.name.toLowerCase();
  return (
    file.type.startsWith("text/") ||
    /\.(html?|css|m?js|ts|tsx|jsx|json|gltf|glsl|wgsl|md|txt|csv|xml|svg|obj|mtl)$/i.test(lower)
  );
}

function isPlayableAudioFile(file: MorphusFileRecord) {
  return /\.(mp3|wav|ogg|m4a)$/i.test(file.path) || /^data:audio\//i.test(file.content);
}

function resolveAudioSource(file: MorphusFileRecord) {
  return file.content;
}

function extensionFromMimeType(mimeType: string) {
  if (mimeType === "image/jpeg") return "jpg";
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  if (mimeType === "image/gif") return "gif";
  if (mimeType === "image/svg+xml") return "svg";
  return "png";
}

function slugifyAssetName(value: string) {
  return value
    .toLowerCase()
    .replace(/\.[^.]+$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function buildMorphusImageAssetPath(existingPaths: string[], image: CopilotImageAttachment, index: number) {
  const existing = new Set(existingPaths.map((path) => path.toLowerCase()));
  const ext = extensionFromMimeType(image.mimeType);
  const baseName = slugifyAssetName(image.name || `reference-image-${index + 1}`) || `reference-image-${index + 1}`;
  let path = `assets/images/${baseName}.${ext}`;
  let suffix = 2;

  while (existing.has(path.toLowerCase())) {
    path = `assets/images/${baseName}-${suffix}.${ext}`;
    suffix += 1;
  }

  return path;
}

function encodeMorphusFile(file: MorphusFileRecord) {
  if (file.content.startsWith("data:")) {
    return dataUrlToBytes(file.content);
  }

  return new TextEncoder().encode(file.content);
}

function dataUrlToBytes(dataUrl: string) {
  const match = dataUrl.match(/^data:([^;,]+)?(?:;charset=[^;,]+)?(;base64)?,(.*)$/i);
  if (!match) {
    throw new Error("Unsupported data URL asset.");
  }

  const [, , base64Flag, payload] = match;
  if (base64Flag) {
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
  }

  return new TextEncoder().encode(decodeURIComponent(payload));
}

function downloadBinaryFile(filename: string, content: Uint8Array, type: string) {
  const bytes = new Uint8Array(content.byteLength);
  bytes.set(content);
  const url = URL.createObjectURL(new Blob([bytes.buffer], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function slugifyFilename(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "morphus-project";
}

function MorphusStart({
  isConfigured,
  latestGame,
  onAbort,
  onClearGame,
  onClearHistory,
  onClose,
  onPlayInViewport,
  onSendMessage,
  onSettingsChanged,
  session
}: Omit<MorphusWorkspaceProps, "files" | "onSaveFile">) {
  return (
    <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden bg-[#0b0f14]">
      <header className="absolute inset-x-0 top-0 z-10 flex h-14 items-center justify-between px-5">
        <div className="flex items-center gap-3">
          <span className="flex size-8 items-center justify-center rounded-xl border border-[#f6d07d]/20 bg-[#f6d07d]/10 text-[#f6d07d]">
            <Code2 className="size-4" />
          </span>
          <div>
            <div className="text-[11px] font-semibold tracking-[0.22em] text-white/86 uppercase">
              Morphus
            </div>
            <div className="text-[10px] text-white/38">HTML game maker</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* TODO: Remove or secure before production */}
          <RagIngestionUI />
          <Button
            aria-label="Close Morphus"
            className="editor-toolbar-button size-8 rounded-[10px]"
            onClick={onClose}
            size="icon-sm"
            variant="ghost"
          >
            <X className="size-3.5" />
          </Button>
        </div>
      </header>

      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_50%_20%,rgba(52,211,153,0.16),transparent_28%),radial-gradient(circle_at_72%_70%,rgba(56,189,248,0.1),transparent_26%),linear-gradient(rgba(255,255,255,0.018)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.018)_1px,transparent_1px)] bg-[length:auto,auto,72px_72px,72px_72px]" />

      <div className="relative z-0 flex min-h-0 flex-1 items-center justify-center px-6 py-16">
        <div className="w-full max-w-2xl">
          <div className="mb-5 text-center">
            <h2 className="text-3xl font-semibold tracking-normal text-white">Create Anything</h2>
            <p className="mt-2 text-sm text-white/42">Describe the playable HTML game you want to build.</p>
          </div>
          <div className="mx-auto h-[28rem] max-w-xl">
            <CopilotPanel
              emptyText="Tell Morphus what to make."
              isConfigured={isConfigured}
              latestGame={latestGame}
              onAbort={onAbort}
              onClearGame={onClearGame}
              onClearHistory={onClearHistory}
              onClose={onClose}
              onPlayInViewport={onPlayInViewport}
              onSendMessage={onSendMessage}
              onSettingsChanged={onSettingsChanged}
              placeholder="What do you want to create?"
              session={session}
              title="Morphus"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
