import { useCallback, useEffect, useState } from "react";
import { Loader2, MessageCircle, Volume2, X } from "lucide-react";
import { useSnapshot } from "valtio";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { generateNpcReply } from "@/lib/preview-npc-chat";
import { speak } from "@/lib/elevenlabs-client";
import { loadCopilotSettings } from "@/lib/copilot/settings";
import { previewNpcDialogueStore } from "@/state/preview-npc-dialogue-store";

function isTextInputTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      target.isContentEditable)
  );
}

export function PreviewNpcDialogueOverlay() {
  const snap = useSnapshot(previewNpcDialogueStore);
  const [draft, setDraft] = useState("");

  const close = useCallback(() => {
    previewNpcDialogueStore.session = null;
    previewNpcDialogueStore.error = null;
    previewNpcDialogueStore.busy = false;
    setDraft("");
  }, []);

  const send = useCallback(async () => {
    const session = previewNpcDialogueStore.session;
    const text = draft.trim();
    if (!session || !text || previewNpcDialogueStore.busy) {
      return;
    }

    const entityId = session.entityId;
    const voiceId = session.voiceId || "JBFqnCBsd6RMkjVDRZzb"; // fallback to "George" default voice
    previewNpcDialogueStore.busy = true;
    previewNpcDialogueStore.error = null;
    setDraft("");

    const historySnapshot = session.history.map((t) => ({ role: t.role, text: t.text }));

    const settings = loadCopilotSettings();

    try {
      const reply = await generateNpcReply({
        characterPrompt: session.characterPrompt,
        history: historySnapshot,
        npcName: session.displayName,
        userMessage: text,
        apiKey: settings.geminiApiKey,
        model: settings.gemini.model
      });

      const active = previewNpcDialogueStore.session;
      if (!active || active.entityId !== entityId) {
        return;
      }

      active.history.push({ role: "user", text });
      active.history.push({ role: "assistant", text: reply });

      if (voiceId) {
        try {
          await speak(reply, { voiceId });
        } catch (ttsErr) {
          // TTS failure shouldn't block the text reply
          console.warn("[NPC TTS]", ttsErr);
        }
      }
    } catch (err) {
      previewNpcDialogueStore.error = err instanceof Error ? err.message : "Request failed.";
    } finally {
      previewNpcDialogueStore.busy = false;
    }
  }, [draft]);

  if (!snap.session) {
    return null;
  }

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-40 flex justify-center p-3">
      <div className="pointer-events-auto flex w-full max-w-lg flex-col gap-2 rounded-2xl border border-white/12 bg-black/72 px-3 py-2.5 shadow-xl backdrop-blur-md">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-white/88">
            <MessageCircle className="size-3.5 text-emerald-300/90" />
            <span className="truncate">{snap.session.displayName}</span>
            {!snap.session.voiceId ? (
              <span className="rounded-md bg-purple-500/15 px-1.5 py-0.5 text-[9px] font-normal text-purple-200/90">
                <Volume2 className="mr-0.5 inline size-2.5" />
                Default voice
              </span>
            ) : (
              <span className="rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-normal text-emerald-200/90">
                <Volume2 className="mr-0.5 inline size-2.5" />
                Voice assigned
              </span>
            )}
          </div>
          <Button className="h-7 w-7 shrink-0" onClick={close} size="icon" variant="ghost">
            <X className="size-3.5" />
          </Button>
        </div>

        <div className="max-h-32 space-y-1.5 overflow-y-auto rounded-lg bg-white/[0.04] px-2 py-1.5 text-[10px] leading-snug text-white/72">
          {snap.session.history.length === 0 ? (
            <div className="text-white/38">Say something to this NPC…</div>
          ) : (
            snap.session.history.map((turn, i) => (
              <div key={`${i}:${turn.text.slice(0, 12)}`}>
                <span className={turn.role === "user" ? "text-sky-300/90" : "text-emerald-200/88"}>
                  {turn.role === "user" ? "You: " : `${snap.session!.displayName}: `}
                </span>
                {turn.text}
              </div>
            ))
          )}
        </div>

        {snap.error ? (
          <div className="rounded-lg border border-red-400/25 bg-red-500/10 px-2 py-1 text-[10px] text-red-200/90">{snap.error}</div>
        ) : null}

        <div className="flex gap-2">
          <Textarea
            className="min-h-[52px] resize-none border-white/10 bg-white/[0.06] text-[11px] text-white/88 placeholder:text-white/32"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder="Type a message…"
            value={draft}
          />
          <Button
            className="h-auto shrink-0 self-stretch px-3"
            disabled={snap.busy || !draft.trim()}
            onClick={() => void send()}
            variant="secondary"
          >
            {snap.busy ? <Loader2 className="size-4 animate-spin" /> : "Send"}
          </Button>
        </div>
        <div className="text-[9px] text-white/32">Uses Gemini from Copilot settings and ElevenLabs for speech (preview only).</div>
      </div>
    </div>
  );
}
