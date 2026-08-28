import { useState, useMemo } from "react";
import {
  X,
  Maximize2,
  Minimize2,
  FileCode,
  FileText,
  Workflow,
  Globe,
  Image as ImageIcon,
  Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ArtifactMetadata, ArtifactFeedbackResponse } from "@/types/artifacts";
import { MonacoDiffViewer } from "@/components/artifacts/MonacoDiffViewer";
import { LiveSandbox } from "@/components/artifacts/LiveSandbox";
import { MermaidViewer } from "@/components/artifacts/MermaidViewer";
import { MarkdownArtifactViewer } from "@/components/artifacts/MarkdownArtifactViewer";
import { VisualEvidenceGallery } from "@/components/artifacts/VisualEvidenceGallery";
import { ArtifactFeedbackBar } from "@/components/artifacts/ArtifactFeedbackBar";

interface ArtifactDockProps {
  artifacts: ArtifactMetadata[];
  activeArtifactId?: string | null;
  onSelectArtifact?: (id: string) => void;
  onClose?: () => void;
  onSendFeedback?: (response: ArtifactFeedbackResponse) => void;
  className?: string;
}

export function ArtifactDock({
  artifacts,
  activeArtifactId,
  onSelectArtifact,
  onClose,
  onSendFeedback,
  className = "",
}: ArtifactDockProps) {
  const [fullscreen, setFullscreen] = useState(false);

  const activeArtifact = useMemo(() => {
    if (activeArtifactId) {
      return artifacts.find((a) => a.id === activeArtifactId) || artifacts[0];
    }
    return artifacts[0] || null;
  }, [artifacts, activeArtifactId]);

  if (!activeArtifact && artifacts.length === 0) {
    return null;
  }

  const getFormatIcon = (format: string) => {
    switch (format) {
      case "diff":
        return <FileCode className="h-3.5 w-3.5 text-primary" />;
      case "html":
        return <Globe className="h-3.5 w-3.5 text-emerald-400" />;
      case "mermaid":
        return <Workflow className="h-3.5 w-3.5 text-purple-400" />;
      case "image":
        return <ImageIcon className="h-3.5 w-3.5 text-amber-400" />;
      default:
        return <FileText className="h-3.5 w-3.5 text-muted-foreground" />;
    }
  };

  const handleDownload = () => {
    if (!activeArtifact) return;
    const blob = new Blob([activeArtifact.content], { type: activeArtifact.mimeType || "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = activeArtifact.name;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div
      data-testid="artifact-dock"
      className={`flex flex-col border-l border-border bg-card shadow-xl transition-all duration-200 ${
        fullscreen ? "fixed inset-0 z-50 w-full" : "h-full w-full min-w-[340px] max-w-[850px]"
      } ${className}`}
    >
      {/* Dock Top Tabs */}
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-border bg-secondary/60 px-2">
        {/* Artifact Tabs */}
        <div className="scrollbar-thin flex items-center gap-1 overflow-x-auto">
          {artifacts.map((art) => {
            const isActive = art.id === activeArtifact?.id;
            return (
              <button
                key={art.id}
                onClick={() => onSelectArtifact?.(art.id)}
                className={`flex h-7 items-center gap-1.5 rounded-md px-2.5 font-mono text-[11.5px] transition-colors ${
                  isActive
                    ? "bg-background font-medium text-foreground shadow-xs border border-border/60"
                    : "text-muted-foreground hover:bg-background/40 hover:text-foreground"
                }`}
              >
                {getFormatIcon(art.format)}
                <span className="max-w-[120px] truncate">{art.name}</span>
                {art.revision && (
                  <span className="rounded bg-secondary px-1 text-[9.5px] text-muted-foreground">
                    v{art.revision}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Dock Controls */}
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-foreground"
            title="Download Artifact"
            onClick={handleDownload}
          >
            <Download className="h-3.5 w-3.5" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-foreground"
            title={fullscreen ? "Exit Fullscreen" : "Fullscreen"}
            onClick={() => setFullscreen((f) => !f)}
          >
            {fullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
          </Button>

          {onClose && (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 text-muted-foreground hover:text-foreground"
              title="Close Dock"
              onClick={onClose}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      {/* Artifact Metadata Subheader */}
      {activeArtifact && (
        <div className="flex shrink-0 items-center justify-between border-b border-border/60 bg-secondary/20 px-3 py-1.5 font-mono text-[11px] text-muted-foreground">
          <div className="flex items-center gap-2">
            <span className="font-medium text-foreground">{activeArtifact.name}</span>
            <span>•</span>
            <span className="uppercase">{activeArtifact.format}</span>
            {activeArtifact.byteLength && (
              <>
                <span>•</span>
                <span>{(activeArtifact.byteLength / 1024).toFixed(1)} KB</span>
              </>
            )}
            {activeArtifact.sha256 && (
              <>
                <span>•</span>
                <span title={`SHA-256: ${activeArtifact.sha256}`}>
                  sha:{activeArtifact.sha256.slice(0, 8)}
                </span>
              </>
            )}
          </div>

          {activeArtifact.summary && (
            <span className="max-w-[280px] truncate text-foreground/80" title={activeArtifact.summary}>
              {activeArtifact.summary}
            </span>
          )}
        </div>
      )}

      {/* Multi-Format Canvas */}
      <div className="flex-1 overflow-hidden p-2">
        {activeArtifact ? (
          <RenderArtifactBody artifact={activeArtifact} />
        ) : (
          <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
            Select an artifact to preview
          </div>
        )}
      </div>

      {/* Interactive Feedback Hook */}
      {activeArtifact && (
        <ArtifactFeedbackBar
          artifact={activeArtifact}
          onSendFeedback={onSendFeedback || (() => {})}
        />
      )}
    </div>
  );
}

function RenderArtifactBody({ artifact }: { artifact: ArtifactMetadata }) {
  switch (artifact.format) {
    case "diff":
      return (
        <MonacoDiffViewer
          original={artifact.originalContent || ""}
          modified={artifact.content}
          filename={artifact.name}
        />
      );
    case "html":
      return <LiveSandbox html={artifact.content} title={artifact.name} />;
    case "mermaid":
      return <MermaidViewer chart={artifact.content} title={artifact.name} />;
    case "markdown":
      return <MarkdownArtifactViewer content={artifact.content} title={artifact.name} />;
    case "image":
      return <VisualEvidenceGallery actualUrl={artifact.content} title={artifact.name} />;
    default:
      return (
        <div className="h-full overflow-auto rounded border border-border bg-black/40 p-4 font-mono text-[12px] text-foreground">
          <pre>
            <code>{artifact.content}</code>
          </pre>
        </div>
      );
  }
}
