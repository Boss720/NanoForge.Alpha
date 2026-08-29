import { useState, useEffect, useRef } from "react";
import { ZoomIn, ZoomOut, RotateCcw, Download, Copy, Check, Code } from "lucide-react";
import { Button } from "@/components/ui/button";
import DOMPurify from "dompurify";

export function getPurifier() {
  try {
    if (typeof (DOMPurify as any)?.sanitize === "function") {
      return DOMPurify;
    }
    if (typeof (DOMPurify as any)?.default?.sanitize === "function") {
      return (DOMPurify as any).default;
    }
    if (typeof (DOMPurify as any)?.default === "function" && typeof window !== "undefined") {
      return (DOMPurify as any).default(window);
    }
    if (typeof DOMPurify === "function" && typeof window !== "undefined") {
      return (DOMPurify as any)(window);
    }
  } catch {
    /* ignore */
  }
  return undefined;
}

export function sanitizeMermaidSvg(rawSvg: string): string {
  const purify = getPurifier();

  if (purify && typeof purify.sanitize === "function") {
    return purify.sanitize(rawSvg, {
      USE_PROFILES: { svg: true, svgFilters: true },
      FORBID_TAGS: ["script", "iframe", "object", "embed", "foreignObject"],
      FORBID_ATTR: [
        "onload",
        "onerror",
        "onclick",
        "onmouseover",
        "onfocus",
        "onblur",
        "onmouseenter",
      ],
    });
  }

  // Robust fallback for non-DOM environments
  return rawSvg
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "")
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, "")
    .replace(/<object[\s\S]*?<\/object>/gi, "")
    .replace(/<embed\b[^>]*\/?>/gi, "")
    .replace(/<\/?(script|foreignObject|iframe|object|embed)\b[^>]*>/gi, "")
    .replace(/\son[a-z]+\s*=\s*(['"]).*?\1/gi, "")
    .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, "");
}

interface MermaidViewerProps {
  chart: string;
  title?: string;
  className?: string;
}

export function MermaidViewer({ chart, title = "Architecture Diagram", className = "" }: MermaidViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svgContent, setSvgContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [scale, setScale] = useState(1);
  const [showSource, setShowSource] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let isMounted = true;
    setError(null);

    const renderChart = async () => {
      try {
        // Attempt to load mermaid dynamically from window or unpkg/esm
        const mermaid = (window as unknown as { mermaid?: { render: (id: string, text: string) => Promise<{ svg: string }>; initialize: (cfg: unknown) => void } }).mermaid;

        if (!mermaid) {
          // Dynamic script injection for mermaid if not already present
          if (!document.getElementById("mermaid-script")) {
            const script = document.createElement("script");
            script.id = "mermaid-script";
            script.src = "https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js";
            script.async = true;
            document.body.appendChild(script);
            await new Promise((resolve) => {
              script.onload = resolve;
            });
          }
        }

        const globalMermaid = (window as unknown as { mermaid?: { render: (id: string, text: string) => Promise<{ svg: string }>; initialize: (cfg: unknown) => void } }).mermaid;
        if (globalMermaid) {
          globalMermaid.initialize({
            startOnLoad: false,
            theme: "dark",
            securityLevel: "strict",
          });
          const id = `mermaid-${crypto.randomUUID()}`;
          const { svg } = await globalMermaid.render(id, chart);
          const sanitized = sanitizeMermaidSvg(svg);
          if (isMounted) {
            setSvgContent(sanitized);
            setError(null);
          }
        } else {
          throw new Error("Mermaid library could not be loaded");
        }
      } catch (err) {
        if (isMounted) {
          setError(err instanceof Error ? err.message : "Failed to render diagram");
          setShowSource(true);
        }
      }
    };

    renderChart();

    return () => {
      isMounted = false;
    };
  }, [chart]);

  const handleZoomIn = () => setScale((s) => Math.min(3, s + 0.2));
  const handleZoomOut = () => setScale((s) => Math.max(0.4, s - 0.2));
  const handleResetZoom = () => setScale(1);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(chart);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadSvg = () => {
    if (!svgContent) return;
    const blob = new Blob([svgContent], { type: "image/svg+xml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.toLowerCase().replace(/\s+/g, "_")}.svg`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className={`flex h-full flex-col overflow-hidden rounded-md border border-border bg-card ${className}`}>
      {/* Header Bar */}
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border bg-secondary/40 px-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[12px] font-medium text-foreground">{title}</span>
          <span className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            Mermaid Diagram
          </span>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-1.5">
          <Button
            variant={showSource ? "secondary" : "ghost"}
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-foreground"
            title={showSource ? "Show Diagram" : "View Source"}
            onClick={() => setShowSource((v) => !v)}
          >
            <Code className="h-3.5 w-3.5" />
          </Button>

          {!showSource && (
            <div className="flex items-center gap-0.5 border-r border-border pr-1.5">
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
          )}

          {svgContent && !showSource && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-foreground"
              title="Download SVG"
              onClick={handleDownloadSvg}
            >
              <Download className="h-3.5 w-3.5" />
            </Button>
          )}

          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-2 text-[11px] text-muted-foreground hover:text-foreground"
            onClick={handleCopy}
          >
            {copied ? <Check className="h-3 w-3 text-primary" /> : <Copy className="h-3 w-3" />}
            <span>{copied ? "Copied" : "Source"}</span>
          </Button>
        </div>
      </div>

      {/* Error Alert */}
      {error && (
        <div className="border-b border-amber-500/30 bg-amber-500/10 px-3 py-1 text-[11px] text-amber-400">
          Diagram parse warning: Showing raw source definition.
        </div>
      )}

      {/* Canvas */}
      <div className="scrollbar-thin flex flex-1 items-center justify-center overflow-auto bg-background/95 p-4">
        {showSource || error || !svgContent ? (
          <pre className="h-full w-full overflow-auto rounded bg-secondary/30 p-3 font-mono text-[12px] leading-relaxed text-foreground">
            <code>{chart}</code>
          </pre>
        ) : (
          <div
            ref={containerRef}
            className="flex items-center justify-center transition-transform duration-100"
            style={{ transform: `scale(${scale})`, transformOrigin: "center center" }}
            dangerouslySetInnerHTML={{ __html: svgContent }}
          />
        )}
      </div>
    </div>
  );
}
