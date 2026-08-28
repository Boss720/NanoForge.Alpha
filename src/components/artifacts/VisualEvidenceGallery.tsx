import { useState } from "react";
import { ZoomIn, ZoomOut, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";

interface VisualEvidenceGalleryProps {
  baselineUrl?: string;
  actualUrl?: string;
  diffUrl?: string;
  mismatchRatio?: number;
  title?: string;
  className?: string;
}

export function VisualEvidenceGallery({
  baselineUrl,
  actualUrl,
  diffUrl,
  mismatchRatio,
  title = "Visual Evidence",
  className = "",
}: VisualEvidenceGalleryProps) {
  const [viewMode, setViewMode] = useState<"side-by-side" | "diff" | "overlay">("diff");
  const [overlayAlpha, setOverlayAlpha] = useState(0.5);
  const [scale, setScale] = useState(1);

  const handleZoomIn = () => setScale((s) => Math.min(8, s + 0.5));
  const handleZoomOut = () => setScale((s) => Math.max(0.5, s - 0.5));
  const handleResetZoom = () => setScale(1);

  return (
    <div className={`flex h-full flex-col overflow-hidden rounded-md border border-border bg-card ${className}`}>
      {/* Header Bar */}
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border bg-secondary/40 px-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[12px] font-medium text-foreground">{title}</span>
          {typeof mismatchRatio === "number" && (
            <span
              className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${
                mismatchRatio > 0
                  ? "bg-rose-500/20 text-rose-300"
                  : "bg-emerald-500/20 text-emerald-300"
              }`}
            >
              Diff: {(mismatchRatio * 100).toFixed(2)}%
            </span>
          )}
        </div>

        {/* View Mode & Zoom Controls */}
        <div className="flex items-center gap-2">
          <div className="flex items-center rounded-md border border-border/60 bg-background/60 p-0.5">
            <Button
              variant={viewMode === "diff" ? "secondary" : "ghost"}
              size="sm"
              className="h-5 px-2 text-[10px]"
              onClick={() => setViewMode("diff")}
            >
              Diff Heatmap
            </Button>
            <Button
              variant={viewMode === "side-by-side" ? "secondary" : "ghost"}
              size="sm"
              className="h-5 px-2 text-[10px]"
              onClick={() => setViewMode("side-by-side")}
            >
              Side-by-Side
            </Button>
            <Button
              variant={viewMode === "overlay" ? "secondary" : "ghost"}
              size="sm"
              className="h-5 px-2 text-[10px]"
              onClick={() => setViewMode("overlay")}
            >
              Overlay
            </Button>
          </div>

          <div className="flex items-center gap-0.5 border-l border-border pl-1.5">
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-foreground"
              title="Zoom Out"
              onClick={handleZoomOut}
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </Button>
            <span className="w-10 text-center font-mono text-[11px] text-muted-foreground">
              {Math.round(scale * 100)}%
            </span>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-foreground"
              title="Zoom In"
              onClick={handleZoomIn}
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-foreground"
              title="Reset Zoom"
              onClick={handleResetZoom}
            >
              <RotateCcw className="h-3 w-3" />
            </Button>
          </div>
        </div>
      </div>

      {/* Overlay Slider Control (Only in overlay mode) */}
      {viewMode === "overlay" && (
        <div className="flex items-center gap-3 border-b border-border/40 bg-secondary/20 px-4 py-1.5">
          <span className="font-mono text-[11px] text-muted-foreground">Baseline</span>
          <Slider
            value={[overlayAlpha]}
            min={0}
            max={1}
            step={0.01}
            onValueChange={(val) => setOverlayAlpha(val[0])}
            className="w-48"
          />
          <span className="font-mono text-[11px] text-muted-foreground">Actual</span>
          <span className="ml-auto font-mono text-[11px] text-muted-foreground">
            {Math.round(overlayAlpha * 100)}% actual
          </span>
        </div>
      )}

      {/* Canvas */}
      <div className="scrollbar-thin flex flex-1 items-center justify-center overflow-auto bg-black/40 p-4">
        {viewMode === "diff" && (
          <div
            className="overflow-hidden rounded border border-border bg-card shadow-lg transition-transform"
            style={{ transform: `scale(${scale})`, transformOrigin: "center center" }}
          >
            {diffUrl ? (
              <img src={diffUrl} alt="Diff heatmap" className="max-h-[600px] object-contain" />
            ) : actualUrl ? (
              <img src={actualUrl} alt="Actual screen" className="max-h-[600px] object-contain" />
            ) : (
              <div className="flex h-64 w-96 items-center justify-center text-muted-foreground">
                No visual evidence image provided
              </div>
            )}
          </div>
        )}

        {viewMode === "side-by-side" && (
          <div
            className="grid grid-cols-2 gap-4 transition-transform"
            style={{ transform: `scale(${scale})`, transformOrigin: "center center" }}
          >
            <div className="space-y-1">
              <div className="font-mono text-[11px] text-muted-foreground">Baseline (Expected)</div>
              <div className="overflow-hidden rounded border border-border bg-card">
                {baselineUrl ? (
                  <img src={baselineUrl} alt="Baseline" className="max-h-[500px] object-contain" />
                ) : (
                  <div className="flex h-48 w-64 items-center justify-center text-xs text-muted-foreground">
                    No baseline
                  </div>
                )}
              </div>
            </div>
            <div className="space-y-1">
              <div className="font-mono text-[11px] text-muted-foreground">Actual (Rendered)</div>
              <div className="overflow-hidden rounded border border-border bg-card">
                {actualUrl ? (
                  <img src={actualUrl} alt="Actual" className="max-h-[500px] object-contain" />
                ) : (
                  <div className="flex h-48 w-64 items-center justify-center text-xs text-muted-foreground">
                    No actual image
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {viewMode === "overlay" && (
          <div
            className="relative overflow-hidden rounded border border-border bg-card shadow-lg transition-transform"
            style={{ transform: `scale(${scale})`, transformOrigin: "center center" }}
          >
            {baselineUrl && (
              <img src={baselineUrl} alt="Baseline" className="max-h-[600px] object-contain" />
            )}
            {actualUrl && (
              <img
                src={actualUrl}
                alt="Actual"
                className="absolute inset-0 h-full w-full object-contain"
                style={{ opacity: overlayAlpha }}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}
