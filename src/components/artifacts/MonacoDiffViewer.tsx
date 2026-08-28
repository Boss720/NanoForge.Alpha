import { useState, useMemo } from "react";
import { Copy, Check, Columns, AlignJustify, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";

interface DiffHunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: Array<{
    type: "add" | "del" | "ctx";
    text: string;
    oldLineNo?: number;
    newLineNo?: number;
  }>;
}

interface MonacoDiffViewerProps {
  original?: string;
  modified: string;
  filename?: string;
  viewMode?: "split" | "unified";
  onViewModeChange?: (mode: "split" | "unified") => void;
  className?: string;
}

export function MonacoDiffViewer({
  original = "",
  modified,
  filename = "file.ts",
  viewMode = "split",
  onViewModeChange,
  className = "",
}: MonacoDiffViewerProps) {
  const [copied, setCopied] = useState(false);
  const [currentHunkIdx, setCurrentHunkIdx] = useState(0);

  const hunks = useMemo(() => {
    return computeDiffHunks(original, modified);
  }, [original, modified]);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(modified);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handlePrevHunk = () => {
    if (hunks.length === 0) return;
    setCurrentHunkIdx((prev) => (prev > 0 ? prev - 1 : hunks.length - 1));
  };

  const handleNextHunk = () => {
    if (hunks.length === 0) return;
    setCurrentHunkIdx((prev) => (prev < hunks.length - 1 ? prev + 1 : 0));
  };

  return (
    <div className={`flex h-full flex-col overflow-hidden rounded-md border border-border bg-card ${className}`}>
      {/* Diff Controls Header */}
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border bg-secondary/40 px-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[12px] font-medium text-foreground">{filename}</span>
          <span className="rounded bg-secondary px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
            {hunks.length} {hunks.length === 1 ? "change" : "changes"}
          </span>
        </div>

        <div className="flex items-center gap-1.5">
          {hunks.length > 0 && (
            <div className="flex items-center gap-0.5 border-r border-border pr-1.5">
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground hover:text-foreground"
                title="Previous Change"
                onClick={handlePrevHunk}
              >
                <ChevronUp className="h-3.5 w-3.5" />
              </Button>
              <span className="font-mono text-[11px] text-muted-foreground">
                {currentHunkIdx + 1}/{hunks.length}
              </span>
              <Button
                variant="ghost"
                size="icon"
                className="h-6 w-6 text-muted-foreground hover:text-foreground"
                title="Next Change"
                onClick={handleNextHunk}
              >
                <ChevronDown className="h-3.5 w-3.5" />
              </Button>
            </div>
          )}

          {/* Mode Switcher */}
          <div className="flex items-center rounded-md border border-border/60 bg-background/60 p-0.5">
            <Button
              variant={viewMode === "split" ? "secondary" : "ghost"}
              size="icon"
              className="h-5 w-5 rounded-sm p-0"
              title="Side-by-side diff"
              onClick={() => onViewModeChange?.("split")}
            >
              <Columns className="h-3 w-3" />
            </Button>
            <Button
              variant={viewMode === "unified" ? "secondary" : "ghost"}
              size="icon"
              className="h-5 w-5 rounded-sm p-0"
              title="Unified diff"
              onClick={() => onViewModeChange?.("unified")}
            >
              <AlignJustify className="h-3 w-3" />
            </Button>
          </div>

          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-1 px-2 text-[11px] text-muted-foreground hover:text-foreground"
            onClick={handleCopy}
          >
            {copied ? <Check className="h-3 w-3 text-primary" /> : <Copy className="h-3 w-3" />}
            <span>{copied ? "Copied" : "Copy"}</span>
          </Button>
        </div>
      </div>

      {/* Diff Content Canvas */}
      <div className="scrollbar-thin flex-1 overflow-auto bg-background/95 p-2 font-mono text-[12px] leading-5">
        {hunks.length === 0 ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            No changes detected
          </div>
        ) : viewMode === "split" ? (
          <SplitDiffView hunks={hunks} activeHunkIdx={currentHunkIdx} />
        ) : (
          <UnifiedDiffView hunks={hunks} activeHunkIdx={currentHunkIdx} />
        )}
      </div>
    </div>
  );
}

function UnifiedDiffView({ hunks, activeHunkIdx }: { hunks: DiffHunk[]; activeHunkIdx: number }) {
  return (
    <div className="w-full space-y-3">
      {hunks.map((hunk, hIdx) => (
        <div
          key={hIdx}
          className={`overflow-hidden rounded border transition-colors ${
            hIdx === activeHunkIdx ? "border-primary/50 shadow-sm" : "border-border/60"
          }`}
        >
          <div className="flex items-center justify-between border-b border-border/40 bg-secondary/30 px-2 py-1 text-[11px] text-muted-foreground">
            <span>@@ -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines} @@</span>
          </div>
          <div className="divide-y divide-border/20">
            {hunk.lines.map((line, lIdx) => (
              <div
                key={lIdx}
                className={`flex items-stretch ${
                  line.type === "add"
                    ? "bg-emerald-500/10 text-emerald-300"
                    : line.type === "del"
                    ? "bg-rose-500/10 text-rose-300"
                    : "text-foreground/80 hover:bg-secondary/20"
                }`}
              >
                <span className="w-10 shrink-0 select-none border-r border-border/30 bg-secondary/10 px-2 py-0.5 text-right text-[11px] text-muted-foreground">
                  {line.oldLineNo ?? ""}
                </span>
                <span className="w-10 shrink-0 select-none border-r border-border/30 bg-secondary/10 px-2 py-0.5 text-right text-[11px] text-muted-foreground">
                  {line.newLineNo ?? ""}
                </span>
                <span className="w-6 shrink-0 select-none text-center font-bold">
                  {line.type === "add" ? "+" : line.type === "del" ? "-" : " "}
                </span>
                <span className="flex-1 whitespace-pre px-2 py-0.5">{line.text}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function SplitDiffView({ hunks, activeHunkIdx }: { hunks: DiffHunk[]; activeHunkIdx: number }) {
  return (
    <div className="w-full space-y-3">
      {hunks.map((hunk, hIdx) => {
        const leftLines = hunk.lines.filter((l) => l.type === "del" || l.type === "ctx");
        const rightLines = hunk.lines.filter((l) => l.type === "add" || l.type === "ctx");
        const maxLen = Math.max(leftLines.length, rightLines.length);

        return (
          <div
            key={hIdx}
            className={`overflow-hidden rounded border transition-colors ${
              hIdx === activeHunkIdx ? "border-primary/50 shadow-sm" : "border-border/60"
            }`}
          >
            <div className="flex items-center justify-between border-b border-border/40 bg-secondary/30 px-2 py-1 text-[11px] text-muted-foreground">
              <span>Original (Line {hunk.oldStart})</span>
              <span>Modified (Line {hunk.newStart})</span>
            </div>
            <div className="grid grid-cols-2 divide-x divide-border/40">
              {/* Left Side (Old) */}
              <div className="divide-y divide-border/20">
                {Array.from({ length: maxLen }).map((_, idx) => {
                  const line = leftLines[idx];
                  if (!line) {
                    return <div key={idx} className="h-6 bg-secondary/5" />;
                  }
                  return (
                    <div
                      key={idx}
                      className={`flex items-stretch ${
                        line.type === "del"
                          ? "bg-rose-500/10 text-rose-300"
                          : "text-foreground/80"
                      }`}
                    >
                      <span className="w-9 shrink-0 select-none border-r border-border/30 bg-secondary/10 px-1.5 py-0.5 text-right text-[11px] text-muted-foreground">
                        {line.oldLineNo ?? ""}
                      </span>
                      <span className="w-5 shrink-0 select-none text-center font-bold">
                        {line.type === "del" ? "-" : " "}
                      </span>
                      <span className="flex-1 overflow-x-hidden whitespace-pre px-1.5 py-0.5">
                        {line.text}
                      </span>
                    </div>
                  );
                })}
              </div>

              {/* Right Side (New) */}
              <div className="divide-y divide-border/20">
                {Array.from({ length: maxLen }).map((_, idx) => {
                  const line = rightLines[idx];
                  if (!line) {
                    return <div key={idx} className="h-6 bg-secondary/5" />;
                  }
                  return (
                    <div
                      key={idx}
                      className={`flex items-stretch ${
                        line.type === "add"
                          ? "bg-emerald-500/10 text-emerald-300"
                          : "text-foreground/80"
                      }`}
                    >
                      <span className="w-9 shrink-0 select-none border-r border-border/30 bg-secondary/10 px-1.5 py-0.5 text-right text-[11px] text-muted-foreground">
                        {line.newLineNo ?? ""}
                      </span>
                      <span className="w-5 shrink-0 select-none text-center font-bold">
                        {line.type === "add" ? "+" : " "}
                      </span>
                      <span className="flex-1 overflow-x-hidden whitespace-pre px-1.5 py-0.5">
                        {line.text}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function computeDiffHunks(oldText: string, newText: string): DiffHunk[] {
  const oldLines = oldText ? oldText.split("\n") : [];
  const newLines = newText ? newText.split("\n") : [];

  if (oldText === newText) return [];

  // Simple line-by-line diff algorithm
  const lines: Array<{
    type: "add" | "del" | "ctx";
    text: string;
    oldLineNo?: number;
    newLineNo?: number;
  }> = [];

  let oldIdx = 0;
  let newIdx = 0;

  while (oldIdx < oldLines.length || newIdx < newLines.length) {
    if (oldIdx < oldLines.length && newIdx < newLines.length && oldLines[oldIdx] === newLines[newIdx]) {
      lines.push({
        type: "ctx",
        text: oldLines[oldIdx],
        oldLineNo: oldIdx + 1,
        newLineNo: newIdx + 1,
      });
      oldIdx++;
      newIdx++;
    } else if (oldIdx < oldLines.length && !newLines.includes(oldLines[oldIdx])) {
      lines.push({
        type: "del",
        text: oldLines[oldIdx],
        oldLineNo: oldIdx + 1,
      });
      oldIdx++;
    } else if (newIdx < newLines.length) {
      lines.push({
        type: "add",
        text: newLines[newIdx],
        newLineNo: newIdx + 1,
      });
      newIdx++;
    } else {
      lines.push({
        type: "del",
        text: oldLines[oldIdx],
        oldLineNo: oldIdx + 1,
      });
      oldIdx++;
    }
  }

  // Filter to diff hunks with 3 lines of context
  const hunks: DiffHunk[] = [];
  let currentHunkLines: typeof lines = [];
  let inHunk = false;

  for (let i = 0; i < lines.length; i++) {
    const isChange = lines[i].type !== "ctx";
    if (isChange) {
      if (!inHunk) {
        inHunk = true;
        // grab up to 3 prior context lines
        const startCtx = Math.max(0, i - 3);
        currentHunkLines = lines.slice(startCtx, i);
      }
      currentHunkLines.push(lines[i]);
    } else if (inHunk) {
      currentHunkLines.push(lines[i]);
      // Check if next 3 lines are also context, if so close hunk
      const nextChanges = lines.slice(i + 1, i + 4).some((l) => l.type !== "ctx");
      if (!nextChanges) {
        // finalize hunk
        hunks.push({
          oldStart: currentHunkLines[0]?.oldLineNo ?? 1,
          oldLines: currentHunkLines.filter((l) => l.type !== "add").length,
          newStart: currentHunkLines[0]?.newLineNo ?? 1,
          newLines: currentHunkLines.filter((l) => l.type !== "del").length,
          lines: currentHunkLines,
        });
        currentHunkLines = [];
        inHunk = false;
      }
    }
  }

  if (currentHunkLines.length > 0) {
    hunks.push({
      oldStart: currentHunkLines[0]?.oldLineNo ?? 1,
      oldLines: currentHunkLines.filter((l) => l.type !== "add").length,
      newStart: currentHunkLines[0]?.newLineNo ?? 1,
      newLines: currentHunkLines.filter((l) => l.type !== "del").length,
      lines: currentHunkLines,
    });
  }

  return hunks;
}
