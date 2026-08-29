import { useEffect, useRef, useState } from "react";
import { Download, ExternalLink, Image as ImageIcon, KeyRound, Loader2, Sparkles, Square } from "lucide-react";
import { generateImage, NanoGptError, type GeneratedImage } from "@/lib/nanogpt";
import { formatQuote, X402Error } from "@/lib/x402";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Final roadmap phase (Task A): image generation panel.
 *
 * Lazy-loaded from App (React.lazy) so the panel stays out of the main
 * bundle. Calls lib/nanogpt's `generateImage` with the live connection;
 * results live in component state only (no persistence — the roadmap does
 * not ask for it). Error surfacing mirrors the chat path: NanoGptError's
 * user-displayable message, and a dedicated x402 block (formatted quote +
 * "add a key" hint) on HTTP 402.
 */

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  baseUrl: string;
  apiKey: string;
  connected: boolean;
  /** Opens the ConnectDialog so a demo-mode user can add a key. */
  onOpenSettings: () => void;
}

const SIZES = ["1024x1024", "1024x1792", "1792x1024"] as const;

/** Renderable src for a GeneratedImage: hosted URL wins, else base64 data URI. */
function imageSrc(img: GeneratedImage): string | null {
  if (img.url) return img.url;
  if (img.b64) return `data:image/png;base64,${img.b64}`;
  return null;
}

export default function ImagePanel({ open, onOpenChange, baseUrl, apiKey, connected, onOpenSettings }: Props) {
  const [prompt, setPrompt] = useState("");
  const [size, setSize] = useState<(typeof SIZES)[number]>("1024x1024");
  const [busy, setBusy] = useState(false);
  const [images, setImages] = useState<GeneratedImage[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [x402, setX402] = useState<X402Error | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Closing the dialog aborts any in-flight generation.
  useEffect(() => {
    if (!open) {
      abortRef.current?.abort();
      abortRef.current = null;
      setBusy(false);
    }
  }, [open]);

  const handleGenerate = async () => {
    if (busy || !connected || !prompt.trim()) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setError(null);
    setX402(null);
    try {
      const out = await generateImage(baseUrl, apiKey, { prompt: prompt.trim(), size }, controller.signal);
      setImages(out);
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        setError("Generation stopped.");
      } else if (e instanceof X402Error) {
        setX402(e);
      } else if (e instanceof NanoGptError) {
        setError(e.message);
      } else {
        setError("Unexpected error generating the image.");
      }
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  const handleStop = () => {
    abortRef.current?.abort();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-card sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-mono text-[13px] tracking-wide">
            <ImageIcon className="h-4 w-4 text-primary" /> Image generation
          </DialogTitle>
          <DialogDescription className="text-[12px] text-muted-foreground">
            Text-to-image via nano-gpt's <span className="font-mono">/generate-image</span> endpoint.
          </DialogDescription>
        </DialogHeader>

        {!connected ? (
          /* Demo mode: generation needs a live key — point at the ConnectDialog. */
          <div className="flex flex-col items-center gap-3 rounded-md border border-border bg-secondary/30 px-4 py-8 text-center">
            <KeyRound className="h-5 w-5 text-muted-foreground" />
            <p className="text-[12.5px] leading-relaxed text-muted-foreground">
              Image generation needs a live connection — you're in <span className="text-foreground">demo mode</span>.
              Connect a nano-gpt key first.
            </p>
            <button
              onClick={onOpenSettings}
              className="flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-1.5 font-mono text-[11.5px] font-semibold text-primary-foreground hover:opacity-90"
            >
              <KeyRound className="h-3.5 w-3.5" /> connect a key
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              placeholder="a brutalist console floating in a neon foundry…"
              className="w-full resize-none rounded-md border border-input bg-secondary/40 px-2.5 py-2 font-mono text-[12px] text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-primary/50"
            />

            <div className="flex flex-wrap items-center gap-2">
              <span className="micro-label">size</span>
              {SIZES.map((s) => (
                <button
                  key={s}
                  onClick={() => setSize(s)}
                  className={`rounded-md border px-2.5 py-1 font-mono text-[11px] transition-colors ${
                    size === s
                      ? "border-primary/60 bg-primary/15 text-primary"
                      : "border-border bg-secondary/60 text-muted-foreground hover:border-primary/50 hover:text-foreground"
                  }`}
                >
                  {s}
                </button>
              ))}
              <div className="flex-1" />
              {busy ? (
                <button
                  onClick={handleStop}
                  className="flex items-center gap-1.5 rounded-md border border-destructive/50 px-3.5 py-1.5 font-mono text-[11.5px] text-red-300 hover:bg-destructive/10"
                >
                  <Square className="h-3.5 w-3.5" /> stop
                </button>
              ) : (
                <button
                  onClick={handleGenerate}
                  disabled={!prompt.trim()}
                  className="flex items-center gap-1.5 rounded-md bg-primary px-3.5 py-1.5 font-mono text-[11.5px] font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-40"
                >
                  <Sparkles className="h-3.5 w-3.5" /> generate
                </button>
              )}
            </div>

            {busy && (
              <div className="flex items-center gap-2 rounded-md border border-border bg-secondary/30 px-3 py-2.5 font-mono text-[11.5px] text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" /> generating… this can take a moment
              </div>
            )}

            {/* x402 accountless quote: per-request price + hint to add a key instead. */}
            {x402 && (
              <div className="rounded-md border border-primary/40 bg-primary/10 px-3 py-2.5 text-[11.5px] leading-relaxed text-muted-foreground">
                <span className="text-foreground">Accountless payment required (HTTP 402).</span> This request needs a
                per-request payment
                {x402.quote ? (
                  <>
                    {" "}of <span className="font-mono text-primary">{formatQuote(x402.quote)}</span>
                  </>
                ) : (
                  " (x402 quote not provided)"
                )}
                . Add a subscription key in{" "}
                <button onClick={onOpenSettings} className="text-primary hover:underline">
                  settings
                </button>{" "}
                to skip per-request payments.
              </div>
            )}

            {error && (
              <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11.5px] leading-relaxed text-amber-200">
                {error}
              </div>
            )}

            {images.length > 0 && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {images.map((img, i) => {
                  const src = imageSrc(img);
                  if (!src) return null;
                  return (
                    <figure key={i} className="overflow-hidden rounded-md border border-border bg-secondary/30">
                      <a href={src} target="_blank" rel="noreferrer" title="Open full image">
                        <img src={src} alt={img.revisedPrompt ?? prompt} className="block w-full object-cover" />
                      </a>
                      <figcaption className="space-y-1.5 px-2.5 py-2">
                        {img.revisedPrompt && (
                          <p className="text-[11px] leading-relaxed text-muted-foreground">{img.revisedPrompt}</p>
                        )}
                        <div className="flex items-center gap-3 font-mono text-[10.5px]">
                          <a href={src} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-muted-foreground hover:text-primary">
                            <ExternalLink className="h-3 w-3" /> open full
                          </a>
                          <a href={src} download={`nanoforge-image-${i + 1}.png`} className="flex items-center gap-1 text-muted-foreground hover:text-primary">
                            <Download className="h-3 w-3" /> download
                          </a>
                        </div>
                      </figcaption>
                    </figure>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
