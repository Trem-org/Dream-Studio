import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Download,
  ExternalLink,
  Gamepad2,
  Loader2,
  MessageSquareText,
  Paperclip,
  Send,
  Square,
  Trash2,
  Volume2,
  VolumeX,
  Wrench,
  X,
  Mic
} from "lucide-react";
import { buildGameBlobUrl } from "@/lib/game-html";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CopilotSettingsDialog } from "@/components/editor-shell/CopilotSettingsDialog";
import { parseToolResult } from "@/lib/copilot/activity";
import type {
  CopilotActivityItem,
  CopilotImageAttachment,
  CopilotMessage,
  CopilotSession
} from "@/lib/copilot/types";
import { cn } from "@/lib/utils";
import { useTts } from "@/hooks/useTts";
import { Conversation } from "@elevenlabs/client";
import { loadCopilotSettings } from "@/lib/copilot/settings";

type GeneratedGame = { title: string; html: string };

type CopilotPanelProps = {
  onClose: () => void;
  onSendMessage: (prompt: string, images?: CopilotImageAttachment[]) => void;
  onAbort: () => void;
  onClearHistory: () => void;
  onClearGame?: () => void;
  onPlayInViewport?: () => void;
  onSettingsChanged: () => void;
  session: CopilotSession;
  isConfigured: boolean;
  latestGame?: GeneratedGame | null;
  title?: string;
  emptyText?: string;
  placeholder?: string;
};

export function CopilotPanel({
  onClose,
  onSendMessage,
  onAbort,
  onClearHistory,
  onClearGame,
  onSettingsChanged,
  session,
  isConfigured,
  latestGame,
  title = "Copilot",
  emptyText = "Describe what you want to build.",
  placeholder = "Describe what to build..."
}: CopilotPanelProps) {
  const [input, setInput] = useState("");
  const [attachedImages, setAttachedImages] = useState<CopilotImageAttachment[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isActive = session.status === "thinking" || session.status === "executing";

  const [speechActive, setSpeechActive] = useState(false);
  const [speechConnecting, setSpeechConnecting] = useState(false);
  const [speechSession, setSpeechSession] = useState<any>(null);
  const [speechError, setSpeechError] = useState("");

  useEffect(() => {
    return () => {
      if (speechSession) {
        speechSession.endSession().catch((err: any) => {
          console.error("[CopilotPanel] Clean unmount speech session end error:", err);
        });
      }
    };
  }, [speechSession]);

  const handleToggleSpeech = async () => {
    if (speechActive) {
      if (speechSession) {
        try {
          await speechSession.endSession();
        } catch (err) {
          console.error("[CopilotPanel] Error ending speech session:", err);
        }
      }
      setSpeechActive(false);
      setSpeechConnecting(false);
      setSpeechSession(null);
      return;
    }

    const settings = loadCopilotSettings();
    const agentId = settings.elevenlabsSpeechEngineId;
    const apiKey = settings.elevenlabsApiKey;

    if (!agentId || !apiKey) {
      setSpeechError("Configure ElevenLabs API Key and Speech Engine ID in settings first.");
      setTimeout(() => setSpeechError(""), 4000);
      return;
    }

    setSpeechConnecting(true);
    setSpeechError("");

    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });

      const conversation = await Conversation.startSession({
        agentId,
        onConnect: ({ conversationId }) => {
          console.log("[CopilotPanel] Speech connected:", conversationId);
          setSpeechActive(true);
          setSpeechConnecting(false);
        },
        onDisconnect: () => {
          console.log("[CopilotPanel] Speech disconnected");
          setSpeechActive(false);
          setSpeechConnecting(false);
          setSpeechSession(null);
        },
        onMessage: (message) => {
          console.log("[CopilotPanel] Speech message:", message);
        },
        onError: (error) => {
          console.error("[CopilotPanel] Speech error:", error);
          setSpeechError(error || "Speech connection error");
          setSpeechActive(false);
          setSpeechConnecting(false);
          setSpeechSession(null);
          setTimeout(() => setSpeechError(""), 4000);
        },
      });

      setSpeechSession(conversation);
    } catch (err) {
      console.error("[CopilotPanel] Failed to start speech session:", err);
      setSpeechError(err instanceof Error ? err.message : "Microphone permission denied or connection failed");
      setSpeechConnecting(false);
      setTimeout(() => setSpeechError(""), 4000);
    }
  };

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [session.activity, session.messages, session.status]);

  const visibleMessages = useMemo(
    () =>
      session.messages.filter((message) => {
        if (message.role === "tool") {
          return false;
        }

        if (
          message.role === "assistant" &&
          !message.content.trim() &&
          (!message.toolCalls || message.toolCalls.length === 0)
        ) {
          return false;
        }

        return true;
      }),
    [session.messages]
  );

  const showEmptyState =
    visibleMessages.length === 0 && session.activity.length === 0 && !isActive;

  const handleSubmit = () => {
    const trimmed = input.trim();

    if ((!trimmed && attachedImages.length === 0) || isActive) {
      return;
    }

    const images = attachedImages.length > 0 ? [...attachedImages] : undefined;
    setInput("");
    setAttachedImages([]);
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
    }
    onSendMessage(trimmed || "What do you see in this image?", images);
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";

    for (const file of files) {
      if (!file.type.startsWith("image/")) {
        continue;
      }

      const reader = new FileReader();
      reader.onload = (readerEvent) => {
        const dataUrl = readerEvent.target?.result as string;
        setAttachedImages((previous) => [...previous, { dataUrl, mimeType: file.type, name: file.name }]);
      };
      reader.readAsDataURL(file);
    }
  };

  const removeAttachment = (index: number) => {
    setAttachedImages((previous) => previous.filter((_, imageIndex) => imageIndex !== index));
  };

  const handlePaste = (event: React.ClipboardEvent) => {
    const items = Array.from(event.clipboardData.items);

    for (const item of items) {
      if (!item.type.startsWith("image/")) {
        continue;
      }

      const file = item.getAsFile();
      if (!file) {
        continue;
      }

      const reader = new FileReader();
      reader.onload = (readerEvent) => {
        const dataUrl = readerEvent.target?.result as string;
        setAttachedImages((previous) => [...previous, { dataUrl, mimeType: file.type, name: file.name }]);
      };
      reader.readAsDataURL(file);
    }
  };

  return (
    <div className="glass-panel glass-panel-strong flex h-full flex-col overflow-hidden rounded-[32px]">
      <div className="flex shrink-0 items-start justify-between gap-3 border-b border-white/8 px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[11px] font-medium tracking-[0.18em] text-foreground/52 uppercase">
            <Bot className="size-3.5 text-emerald-400" />
            {title}
          </div>
          {(session.modeLabel || session.modelId || session.iterationCount > 0) && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {session.modeLabel && <HeaderChip label={session.modeLabel} />}
              {session.modelId && <HeaderChip label={session.modelId} />}
              <HeaderChip label={describeStatus(session)} tone={statusTone(session.status)} />
              {session.iterationCount > 0 && <HeaderChip label={`step ${session.iterationCount}`} />}
            </div>
          )}
        </div>

        <div className="flex items-center gap-0.5">
          {(session.messages.length > 0 || session.activity.length > 0) && (
            <Button
              className="size-7 rounded-lg text-foreground/48 hover:text-foreground"
              onClick={onClearHistory}
              size="icon-sm"
              title="Clear history"
              variant="ghost"
            >
              <Trash2 className="size-3.5" />
            </Button>
          )}
          <CopilotSettingsDialog onSaved={onSettingsChanged} />
          <Button
            className="size-7 rounded-lg text-foreground/48 hover:text-foreground"
            onClick={onClose}
            size="icon-sm"
            variant="ghost"
          >
            <X className="size-3.5" />
          </Button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4" ref={scrollRef}>
        {showEmptyState ? (
          <div className="flex h-full items-center justify-center">
            <div className="space-y-2 text-center">
              <Bot className="mx-auto size-8 text-foreground/20" />
              <p className="text-xs text-foreground/40">
                {isConfigured
                  ? emptyText
                  : "Configure your API key in settings to get started."}
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {session.activity.length > 0 && <ProcessTimeline session={session} />}

            {visibleMessages.length > 0 && (
              <div className="space-y-2.5">
                {session.activity.length > 0 && (
                  <SectionLabel
                    icon={<MessageSquareText className="size-3 text-foreground/45" />}
                    label="Conversation"
                  />
                )}
                {visibleMessages.map((message) => (
                  <MessageBubble key={message.id} message={message} />
                ))}
              </div>
            )}

            {isActive && <ThinkingIndicator session={session} />}

            {session.status === "error" && session.error && (
              <div className="rounded-xl border border-rose-400/14 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-300">
                {session.error}
              </div>
            )}
          </div>
        )}
      </div>

      {latestGame && (
        <div className="shrink-0 border-t border-white/8 p-3">
          <GameCard
            game={latestGame}
            onDismiss={onClearGame}
          />
        </div>
      )}

      {attachedImages.length > 0 && (
        <div className="shrink-0 border-t border-white/8 px-4 pt-3 pb-1">
          <div className="flex flex-wrap gap-2">
            {attachedImages.map((image, index) => (
              <div className="relative" key={index}>
                <img
                  alt="attachment"
                  className="size-14 rounded-lg border border-white/10 object-cover"
                  src={image.dataUrl}
                />
                <button
                  className="absolute -top-1 -right-1 flex size-4 items-center justify-center rounded-full bg-black/70 text-white/70 transition-colors hover:text-white"
                  onClick={() => removeAttachment(index)}
                  type="button"
                >
                  <X className="size-2.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="shrink-0 border-t border-white/8 p-4">
        {speechError && (
          <div className="mb-2 rounded-xl border border-rose-400/14 bg-rose-500/10 px-3 py-2 text-[10px] text-rose-300 animate-pulse">
            {speechError}
          </div>
        )}
        {speechActive && (
          <div className="mb-2 flex items-center justify-between rounded-xl border border-emerald-400/14 bg-emerald-500/10 px-3 py-2 text-[10px] text-emerald-300">
            <span className="flex items-center gap-1.5 font-medium">
              <span className="size-2 rounded-full bg-emerald-400 animate-ping" />
              Voice Session Active
            </span>
            <button
              onClick={handleToggleSpeech}
              className="text-[9px] uppercase tracking-wider text-white/44 hover:text-white"
              type="button"
            >
              Disconnect
            </button>
          </div>
        )}
        <input
          accept="image/*"
          className="hidden"
          multiple
          onChange={handleFileChange}
          ref={fileInputRef}
          type="file"
        />
        <div className="flex gap-2">
          <button
            className="flex size-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-foreground/40 transition-colors hover:bg-white/[0.07] hover:text-foreground/72 disabled:pointer-events-none disabled:opacity-40"
            disabled={isActive || !isConfigured}
            onClick={() => fileInputRef.current?.click()}
            title="Attach image"
            type="button"
          >
            <Paperclip className="size-3.5" />
          </button>
          <button
            className={cn(
              "flex size-9 shrink-0 items-center justify-center rounded-xl border transition-all duration-300 relative overflow-hidden",
              speechActive
                ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.2)]"
                : speechConnecting
                ? "border-[#f6d07d]/30 bg-[#f6d07d]/10 text-[#f6d07d]"
                : "border-white/10 bg-white/[0.04] text-foreground/40 hover:bg-white/[0.07] hover:text-foreground/72 disabled:pointer-events-none disabled:opacity-40"
            )}
            disabled={isActive}
            onClick={handleToggleSpeech}
            title={speechActive ? "Disconnect voice session" : speechConnecting ? "Connecting voice..." : "Voice session with Morphus"}
            type="button"
          >
            {speechConnecting ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : speechActive ? (
              <>
                <Mic className="size-3.5" />
                <span className="absolute inset-0 bg-emerald-400/10 animate-ping rounded-xl pointer-events-none" />
              </>
            ) : (
              <Mic className="size-3.5" />
            )}
          </button>
          <textarea
            autoFocus
            className="max-h-32 min-h-9 flex-1 resize-none rounded-xl border border-white/10 bg-white/[0.045] px-3 py-2 text-xs text-foreground placeholder:text-foreground/36 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
            disabled={isActive || !isConfigured}
            onChange={(event) => {
              setInput(event.target.value);
              const el = event.target;
              el.style.height = "auto";
              el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                handleSubmit();
              }
            }}
            onPaste={handlePaste}
            placeholder={isConfigured ? placeholder : "Set up API key first"}
            ref={inputRef}
            rows={1}
            value={input}
          />
          {isActive ? (
            <Button
              className="size-9 shrink-0 rounded-xl"
              onClick={onAbort}
              size="icon"
              variant="destructive"
            >
              <Square className="size-3.5" />
            </Button>
          ) : (
            <Button
              className="size-9 shrink-0 rounded-xl"
              disabled={(!input.trim() && attachedImages.length === 0) || !isConfigured}
              onClick={handleSubmit}
              size="icon"
            >
              <Send className="size-3.5" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function HeaderChip({
  label,
  tone = "default"
}: {
  label: string;
  tone?: "default" | "success" | "warning" | "error";
}) {
  return (
    <span
      className={cn(
        "rounded-full border px-2 py-0.5 text-[10px] font-medium",
        tone === "success" && "border-emerald-400/18 bg-emerald-500/10 text-emerald-200",
        tone === "warning" && "border-amber-400/18 bg-amber-500/10 text-amber-200",
        tone === "error" && "border-rose-400/18 bg-rose-500/10 text-rose-200",
        tone === "default" && "border-white/10 bg-white/[0.05] text-foreground/46"
      )}
    >
      {label}
    </span>
  );
}

function SectionLabel({
  icon,
  label
}: {
  icon: ReactNode;
  label: string;
}) {
  return (
    <div className="flex items-center gap-2 px-1 text-[10px] font-medium tracking-[0.18em] text-foreground/40 uppercase">
      {icon}
      {label}
    </div>
  );
}

function ProcessTimeline({ session }: { session: CopilotSession }) {
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (session.status === "thinking" || session.status === "executing") {
      setExpanded(true);
      return;
    }

    if (session.activity.length <= 10) {
      setExpanded(true);
    }
  }, [session.activity.length, session.status]);

  const visibleItems = expanded ? session.activity : session.activity.slice(-10);
  const canExpand = session.activity.length > 10;

  return (
    <div className="rounded-[24px] border border-white/10 bg-white/[0.03] p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <SectionLabel icon={<Bot className="size-3 text-emerald-400" />} label="Agent Process" />
          <p className="mt-1 px-1 text-[11px] leading-relaxed text-foreground/50">
            Live tool calls, results, and step-by-step status updates.
          </p>
          {session.activeSkills && session.activeSkills.length > 0 && (
            <div className="mt-3 rounded-2xl border border-white/10 bg-black/10 px-3 py-2">
              <div className="text-[10px] font-medium tracking-[0.16em] text-foreground/40 uppercase">
                Antigravity skills
              </div>
              <p className="mt-1 text-[10px] leading-relaxed text-foreground/42">
                {session.skillRootPath}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {session.activeSkills.map((skill) => (
                  <details
                    className="rounded-full border border-emerald-400/18 bg-emerald-500/10 px-2 py-1 text-[10px] text-emerald-200"
                    key={skill.path}
                  >
                    <summary className="cursor-pointer list-none">{skill.name}</summary>
                    <div className="mt-2 max-w-[20rem] rounded-xl border border-white/10 bg-[#07120d] px-3 py-2 text-left text-[10px] leading-relaxed text-foreground/70">
                      <div className="font-medium text-foreground/86">{skill.description}</div>
                      <div className="mt-1 text-foreground/56">{skill.excerpt}</div>
                    </div>
                  </details>
                ))}
              </div>
            </div>
          )}
        </div>
        {canExpand && (
          <button
            className="flex shrink-0 items-center gap-1 rounded-full border border-white/10 bg-white/[0.04] px-2 py-1 text-[10px] font-medium text-foreground/48 transition-colors hover:text-foreground/70"
            onClick={() => setExpanded((current) => !current)}
            type="button"
          >
            {expanded ? <ChevronUp className="size-3" /> : <ChevronDown className="size-3" />}
            {expanded ? "Recent" : `All ${session.activity.length}`}
          </button>
        )}
      </div>

      <div className="mt-3 space-y-2">
        {visibleItems.map((item) => (
          <ActivityCard item={item} key={item.id} />
        ))}
      </div>
    </div>
  );
}

function ActivityCard({ item }: { item: CopilotActivityItem }) {
  const icon = getActivityIcon(item);
  const meta = [
    item.iteration ? `step ${item.iteration}` : null,
    item.elapsedMs != null ? `${item.elapsedMs}ms` : null,
    formatTimestamp(item.timestamp)
  ].filter(Boolean);

  return (
    <div
      className={cn(
        "rounded-2xl border p-3",
        item.tone === "success" && "border-emerald-400/14 bg-emerald-500/[0.08]",
        item.tone === "warning" && "border-amber-400/14 bg-amber-500/[0.08]",
        item.tone === "error" && "border-rose-400/14 bg-rose-500/[0.08]",
        (!item.tone || item.tone === "info") && "border-white/10 bg-white/[0.03]"
      )}
    >
      <div className="flex items-start gap-3">
        <div
          className={cn(
            "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border",
            item.tone === "success" && "border-emerald-400/18 bg-emerald-500/10 text-emerald-300",
            item.tone === "warning" && "border-amber-400/18 bg-amber-500/10 text-amber-300",
            item.tone === "error" && "border-rose-400/18 bg-rose-500/10 text-rose-300",
            (!item.tone || item.tone === "info") && "border-white/10 bg-white/[0.05] text-foreground/62"
          )}
        >
          {icon}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-[10px] font-medium tracking-[0.16em] text-foreground/40 uppercase">
                {describeActivityKind(item.kind)}
              </div>
              <div className="mt-1 text-[12px] font-medium text-foreground/86">{item.title}</div>
            </div>
            <div className="shrink-0 text-right text-[10px] text-foreground/36">{meta.join(" · ")}</div>
          </div>

          {item.detail && (
            <p className="mt-1.5 text-[11px] leading-relaxed text-foreground/56">{item.detail}</p>
          )}

          {item.toolCall && <JsonDetails label="Arguments" value={item.toolCall.args} />}

          {item.toolResult && (
            <JsonDetails
              label={item.tone === "error" ? "Failure payload" : "Result payload"}
              value={parseToolResult(item.toolResult.result).payload}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function JsonDetails({ label, value }: { label: string; value: unknown }) {
  const content = useMemo(() => {
    if (typeof value === "string") {
      return value;
    }

    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }, [value]);

  return (
    <details className="mt-2 overflow-hidden rounded-xl border border-white/10 bg-black/10">
      <summary className="cursor-pointer px-3 py-2 text-[10px] font-medium text-foreground/45">
        {label}
      </summary>
      <pre className="border-t border-white/8 px-3 py-2 text-[10px] leading-relaxed text-foreground/70 whitespace-pre-wrap">
        {content}
      </pre>
    </details>
  );
}

function MessageBubble({ message }: { message: CopilotMessage }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] space-y-1.5">
          {message.images && message.images.length > 0 && (
            <div className="flex flex-wrap justify-end gap-1.5">
              {message.images.map((image, index) => (
                <img
                  alt="attachment"
                  className="max-h-40 max-w-[200px] rounded-xl border border-white/10 object-cover"
                  key={index}
                  src={image.dataUrl}
                />
              ))}
            </div>
          )}
          {message.content && (
            <div className="rounded-2xl rounded-br-md border border-emerald-300/14 bg-[linear-gradient(180deg,rgba(52,211,153,0.24),rgba(5,150,105,0.12)_100%)] px-3 py-2 text-xs text-foreground/92 shadow-[0_14px_30px_rgba(4,18,15,0.18)]">
              {message.content}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {message.toolCalls && message.toolCalls.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {message.toolCalls.map((toolCall) => (
            <div
              className="glass-pill flex items-center gap-1 rounded-full px-2 py-1 text-[9px] text-emerald-200"
              key={toolCall.id}
            >
              <Wrench className="size-2" />
              {toolCall.name}
            </div>
          ))}
        </div>
      )}
      {message.content && (
        <div className="group relative">
          <MarkdownContent content={message.content} />
          <SpeakButton text={message.content} />
        </div>
      )}
    </div>
  );
}

function SpeakButton({ text }: { text: string }) {
  const { speak, speaking, cancel } = useTts();

  return (
    <button
      aria-label={speaking ? "Stop speaking" : "Read aloud"}
      className={cn(
        "absolute -bottom-1 right-1 flex size-5 items-center justify-center rounded-full opacity-0 transition-opacity group-hover:opacity-100",
        "text-foreground/40 hover:text-emerald-400",
        speaking && "opacity-100 text-emerald-400"
      )}
      onClick={() => (speaking ? cancel() : speak(text))}
      title={speaking ? "Stop" : "Read aloud"}
      type="button"
    >
      {speaking ? <VolumeX className="size-3" /> : <Volume2 className="size-3" />}
    </button>
  );
}

function MarkdownContent({ content }: { content: string }) {
  const html = useMemo(() => renderMarkdown(content), [content]);

  return (
    <div
      className="copilot-markdown glass-section max-w-[95%] rounded-2xl rounded-bl-md px-3 py-2 text-xs leading-relaxed text-foreground/74"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function renderMarkdown(text: string): string {
  let html = escapeHtml(text);

  html = html.replace(
    /^#### (.+)$/gm,
    '<h4 class="mt-2 mb-0.5 text-[11px] font-semibold text-foreground/80">$1</h4>'
  );
  html = html.replace(
    /^### (.+)$/gm,
    '<h3 class="mt-2 mb-0.5 text-xs font-semibold text-foreground/85">$1</h3>'
  );
  html = html.replace(
    /^## (.+)$/gm,
    '<h2 class="mt-2 mb-0.5 text-xs font-bold text-foreground/90">$1</h2>'
  );
  html = html.replace(
    /^# (.+)$/gm,
    '<h1 class="mt-2 mb-0.5 text-[13px] font-bold text-foreground/92">$1</h1>'
  );

  html = html.replace(
    /```(\w*)\n([\s\S]*?)```/g,
    (_match, _language, code) =>
      `<pre class="my-1 overflow-x-auto rounded-lg bg-white/[0.06] px-2 py-1.5 text-[10px] leading-snug"><code>${code.trim()}</code></pre>`
  );

  html = html.replace(
    /`([^`]+)`/g,
    '<code class="rounded bg-white/[0.08] px-1 py-px text-[10px] text-emerald-200">$1</code>'
  );
  html = html.replace(
    /\*\*([^*]+)\*\*/g,
    '<strong class="font-semibold text-foreground/88">$1</strong>'
  );
  html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, "<em>$1</em>");

  html = html.replace(/^[\-\*] (.+)$/gm, '<li class="ml-3 list-disc">$1</li>');
  html = html.replace(/((?:<li[^>]*>.*<\/li>\n?)+)/g, '<ul class="my-1 space-y-0.5">$1</ul>');

  html = html.replace(/^\d+\. (.+)$/gm, '<li class="ml-3 list-decimal">$1</li>');
  html = html.replace(
    /((?:<li class="ml-3 list-decimal">.*<\/li>\n?)+)/g,
    '<ul class="my-1 space-y-0.5">$1</ul>'
  );

  html = html.replace(/\n\n+/g, '</p><p class="mt-1.5">');
  html = `<p>${html}</p>`;
  html = html.replace(/(?<!<\/pre>)\n(?!<)/g, "<br>");

  return html;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function ThinkingIndicator({ session }: { session: CopilotSession }) {
  return (
    <div className="flex items-center gap-2 py-1">
      <Loader2 className="size-3 animate-spin text-emerald-400" />
      <span className="text-[10px] text-foreground/48">
        {session.status === "executing"
          ? "Executing tools..."
          : `Thinking${session.iterationCount > 0 ? ` (step ${session.iterationCount})` : ""}...`}
      </span>
    </div>
  );
}

function GameCard({
  game,
  onDismiss
}: {
  game: GeneratedGame;
  onDismiss?: () => void;
}) {
  const openGame = () => {
    const url = buildGameBlobUrl(game.html);
    window.open(url, "_blank");
  };

  const downloadGame = () => {
    const url = buildGameBlobUrl(game.html);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${game.title.toLowerCase().replace(/\s+/g, "-")}.html`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  return (
    <div className="rounded-xl border border-emerald-400/20 bg-emerald-500/[0.08] p-3">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <div className="min-w-0 flex items-center gap-1.5">
          <Gamepad2 className="size-3.5 shrink-0 text-emerald-400" />
          <span className="truncate text-[11px] font-medium text-foreground/80">{game.title}</span>
        </div>
        {onDismiss && (
          <button
            className="shrink-0 text-foreground/32 transition-colors hover:text-foreground/60"
            onClick={onDismiss}
            title="Dismiss"
            type="button"
          >
            <X className="size-3" />
          </button>
        )}
      </div>
      <div className="flex gap-1.5">
        <button
          className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-emerald-400/20 bg-emerald-500/20 px-2.5 py-1.5 text-[10px] font-medium text-emerald-300 transition-colors hover:bg-emerald-500/30"
          onClick={openGame}
          title="Open in new tab"
          type="button"
        >
          <ExternalLink className="size-3" />
          Open game
        </button>
        <button
          className="flex items-center justify-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[10px] font-medium text-foreground/52 transition-colors hover:bg-white/[0.07] hover:text-foreground/72"
          onClick={downloadGame}
          title="Download HTML file"
          type="button"
        >
          <Download className="size-3" />
        </button>
      </div>
    </div>
  );
}

function describeStatus(session: CopilotSession): string {
  if (session.status === "executing") {
    return "working";
  }

  if (session.status === "thinking") {
    return "planning";
  }

  if (session.status === "aborted") {
    return "stopped";
  }

  if (session.status === "error") {
    return "error";
  }

  return "ready";
}

function statusTone(status: CopilotSession["status"]): "default" | "success" | "warning" | "error" {
  if (status === "error") {
    return "error";
  }

  if (status === "aborted") {
    return "warning";
  }

  if (status === "idle") {
    return "success";
  }

  return "default";
}

function describeActivityKind(kind: CopilotActivityItem["kind"]): string {
  switch (kind) {
    case "session":
      return "Session";
    case "step":
      return "Step";
    case "tool_call":
      return "Tool call";
    case "tool_result":
      return "Tool result";
    case "assistant":
      return "Assistant";
    case "status":
      return "Status";
    case "error":
      return "Error";
    default:
      return "Update";
  }
}

function getActivityIcon(item: CopilotActivityItem) {
  if (item.kind === "tool_call") {
    return <Wrench className="size-3.5" />;
  }

  if (item.kind === "tool_result") {
    return item.tone === "error" ? (
      <AlertTriangle className="size-3.5" />
    ) : (
      <CheckCircle2 className="size-3.5" />
    );
  }

  if (item.kind === "assistant") {
    return <MessageSquareText className="size-3.5" />;
  }

  if (item.kind === "error" || item.tone === "error") {
    return <AlertTriangle className="size-3.5" />;
  }

  if (item.kind === "status" && item.tone === "success") {
    return <CheckCircle2 className="size-3.5" />;
  }

  return <Bot className="size-3.5" />;
}

function formatTimestamp(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}
