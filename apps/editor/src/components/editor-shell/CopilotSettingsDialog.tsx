import { useState } from "react";
import { Settings, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog";
import type { CopilotSettings, GeminiModelId } from "@/lib/copilot/types";
import { loadCopilotSettings, saveCopilotSettings } from "@/lib/copilot/settings";
import { setupSpeechEngine } from "@/lib/elevenlabs-client";

export function CopilotSettingsDialog({ onSaved }: { onSaved?: () => void }) {
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState<CopilotSettings>(loadCopilotSettings);
  const [showElevenLabsKey, setShowElevenLabsKey] = useState(false);
  const [showGeminiKey, setShowGeminiKey] = useState(false);

  const handleSave = () => {
    saveCopilotSettings(settings);
    setOpen(false);
    onSaved?.();
    setupSpeechEngine().catch((err) =>
      console.error("[CopilotSettingsDialog] Speech Engine setup failed:", err)
    );
  };

  return (
    <Dialog onOpenChange={setOpen} open={open}>
      <DialogTrigger
        render={
          <Button className="size-7 rounded-lg text-foreground/48 hover:text-foreground" size="icon-sm" variant="ghost" />
        }
      >
        <Settings className="size-3.5" />
      </DialogTrigger>
      <DialogContent className="border-white/10 bg-[#0a1510] sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Vibe Settings</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="space-y-1.5">
            <label className="text-[11px] font-medium tracking-[0.18em] text-foreground/52 uppercase">
              Gemini Model
            </label>
            <select
              className="flex h-10 w-full rounded-xl border border-white/10 bg-white/[0.045] px-3 py-2 text-sm text-foreground outline-none focus:ring-1 focus:ring-ring"
              onChange={(e) => setSettings({ ...settings, gemini: { model: e.target.value as GeminiModelId } })}
              value={settings.gemini.model}
            >
              <option value="gemini-3.1-pro-preview" className="bg-[#0a1510] text-foreground">gemini-3.1-pro-preview</option>
              <option value="gemini-3-flash-preview" className="bg-[#0a1510] text-foreground">gemini-3-flash-preview</option>
              <option value="gemini-3.5-flash" className="bg-[#0a1510] text-foreground">gemini-3.5-flash</option>
            </select>
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-medium tracking-[0.18em] text-foreground/52 uppercase">
              Gemini API Key
            </label>
            <div className="relative">
              <Input
                className="h-10 rounded-xl border-white/10 bg-white/[0.045] pr-10 text-sm font-mono"
                onChange={(e) => setSettings({ ...settings, geminiApiKey: e.target.value })}
                placeholder="Enter your Gemini API key"
                type={showGeminiKey ? "text" : "password"}
                value={settings.geminiApiKey || ""}
              />
              <Button
                className="absolute right-1 top-1 size-8 rounded-lg text-foreground/48"
                onClick={() => setShowGeminiKey(!showGeminiKey)}
                size="icon-sm"
                variant="ghost"
              >
                {showGeminiKey ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
              </Button>
            </div>
            <p className="text-[10px] text-foreground/36">
              Used for code generation and NPC chat. Stored locally in your browser.
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-medium tracking-[0.18em] text-foreground/52 uppercase">
              ElevenLabs API Key
            </label>
            <div className="relative">
              <Input
                className="h-10 rounded-xl border-white/10 bg-white/[0.045] pr-10 text-sm font-mono"
                onChange={(e) => setSettings({ ...settings, elevenlabsApiKey: e.target.value })}
                placeholder="Enter your ElevenLabs API key"
                type={showElevenLabsKey ? "text" : "password"}
                value={settings.elevenlabsApiKey}
              />
              <Button
                className="absolute right-1 top-1 size-8 rounded-lg text-foreground/48"
                onClick={() => setShowElevenLabsKey(!showElevenLabsKey)}
                size="icon-sm"
                variant="ghost"
              >
                {showElevenLabsKey ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
              </Button>
            </div>
            <p className="text-[10px] text-foreground/36">
              Used for voice and audio features. Stored locally in your browser.
            </p>
          </div>

          <div className="space-y-1.5">
            <label className="text-[11px] font-medium tracking-[0.18em] text-foreground/52 uppercase">
              ElevenLabs Speech Engine ID
            </label>
            <Input
              className="h-10 rounded-xl border-white/10 bg-white/[0.045] text-sm font-mono"
              onChange={(e) => setSettings({ ...settings, elevenlabsSpeechEngineId: e.target.value })}
              placeholder="e.g. seng_8k3m9xr4..."
              value={settings.elevenlabsSpeechEngineId || ""}
            />
            <p className="text-[10px] text-foreground/36">
              ID of the speech engine to route voice connections.
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button className="rounded-xl" onClick={() => setOpen(false)} size="sm" variant="ghost">
              Cancel
            </Button>
            <Button className="rounded-xl" onClick={handleSave} size="sm">
              Save
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
