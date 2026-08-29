import { useState } from "react";
import { CheckCircle2, ImageOff, ScanEye, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Agent platform — Module 3, Task 9 (UI half).
 *
 * Pure, controlled view over the visual-verification evidence the local agent
 * host produces for a browser run: element/text/URL assertions plus an
 * optional thresholded pixel diff. All artifact references are RELATIVE paths
 * inside the run's artifact directory (Task 19 stores them relative on
 * purpose); this component never absolutizes them — the wiring layer decides
 * how the host serves them. With the host absent the images simply show the
 * path placeholder, so the static build keeps working.
 *
 * JSON-serializable in, nothing out — the card is read-only evidence.
 */

export type VisualAssertionKind = "expect_visible" | "expect_text" | "expect_url";

export interface VisualAssertionResult {
  id: string;
  kind: VisualAssertionKind;
  /** Selector or URL pattern the assertion ran against. */
  target: string;
  /** Expected value — text content or URL; for expect_visible, the selector. */
  expected: string;
  /** Observed value; null/undefined when nothing could be observed. */
  actual?: string | null;
  passed: boolean;
}

export interface VisualDiffResult {
  /** Run-artifact-relative path to the baseline screenshot. */
  baselinePath: string;
  /** Run-artifact-relative path to the current screenshot. */
  currentPath: string;
  /** Run-artifact-relative path to the diff overlay image. */
  overlayPath: string;
  /** Fraction of differing pixels, 0..1. */
  diffRatio: number;
  /** Max tolerated ratio — the diff fails when diffRatio > threshold. */
  threshold: number;
}

export interface VisualEvidenceCardProps {
  assertions?: VisualAssertionResult[];
  diff?: VisualDiffResult | null;
  className?: string;
}

const ASSERTION_LABEL: Record<VisualAssertionKind, string> = {
  expect_visible: "visible",
  expect_text: "text",
  expect_url: "url",
};

const fmtPct = (ratio: number) => `${(ratio * 100).toFixed(2)}%`;

export function VisualEvidenceCard({ assertions = [], diff = null, className }: VisualEvidenceCardProps) {
  const failed = assertions.filter((a) => !a.passed).length;
  const diffFailed = diff !== null && diff.diffRatio > diff.threshold;

  return (
    <section
      aria-label="Visual verification evidence"
      className={cn("rounded-md border border-border bg-card", className)}
    >
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <ScanEye className="h-3.5 w-3.5 text-primary" />
        <span className="font-mono text-[11px] font-semibold tracking-wide text-foreground">
          visual verification
        </span>
        <div className="flex-1" />
        {assertions.length > 0 && (
          <span
            className={cn(
              "font-mono text-[10px]",
              failed > 0 ? "text-red-400" : "text-emerald-400",
            )}
          >
            {failed > 0
              ? `${failed}/${assertions.length} assertions failed`
              : `${assertions.length}/${assertions.length} assertions passed`}
          </span>
        )}
      </div>

      {assertions.length > 0 && (
        <ul className="divide-y divide-border/60">
          {assertions.map((a) => (
            <li key={a.id} className="px-3 py-2" data-status={a.passed ? "passed" : "failed"}>
              <div className="flex items-center gap-1.5">
                {a.passed ? (
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" aria-label="passed" />
                ) : (
                  <XCircle className="h-3.5 w-3.5 shrink-0 text-red-400" aria-label="failed" />
                )}
                <span className="rounded bg-secondary px-1 py-px font-mono text-[9.5px] text-muted-foreground">
                  {ASSERTION_LABEL[a.kind]}
                </span>
                <span className="truncate font-mono text-[11px] text-foreground" title={a.target}>
                  {a.target}
                </span>
              </div>
              <div className="mt-1 grid grid-cols-[auto_1fr] gap-x-2 gap-y-0.5 pl-5 font-mono text-[10.5px]">
                <span className="text-muted-foreground">expected</span>
                <span className="break-all text-foreground">{a.expected}</span>
                <span className="text-muted-foreground">actual</span>
                <span
                  className={cn(
                    "break-all",
                    a.passed ? "text-foreground" : "text-red-300",
                  )}
                >
                  {a.actual ?? "—"}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      {diff && (
        <div className="border-t border-border px-3 py-2.5">
          <div className="mb-2 flex items-center gap-2">
            <span className="micro-label">pixel diff</span>
            <div className="flex-1" />
            <span
              className={cn(
                "font-mono text-[10px]",
                diffFailed ? "text-red-400" : "text-emerald-400",
              )}
            >
              diff {fmtPct(diff.diffRatio)} / threshold {fmtPct(diff.threshold)}{" "}
              {diffFailed ? "· failed" : "· within tolerance"}
            </span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-secondary">
            <div
              className={cn("h-full", diffFailed ? "bg-red-500" : "bg-emerald-500")}
              style={{ width: `${Math.min(100, diff.diffRatio * 100)}%` }}
              role="progressbar"
              aria-valuenow={Math.round(diff.diffRatio * 100)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="pixel diff ratio"
            />
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2">
            <EvidenceImage label="baseline" path={diff.baselinePath} />
            <EvidenceImage label="current" path={diff.currentPath} />
            {/* A failed diff visually highlights the overlay so the changed
                region is the first thing the eye lands on. */}
            <EvidenceImage
              label="diff overlay"
              path={diff.overlayPath}
              highlight={diffFailed}
            />
          </div>
        </div>
      )}

      {assertions.length === 0 && !diff && (
        <p className="px-3 py-4 text-center font-mono text-[11px] text-muted-foreground">
          no visual evidence recorded for this run
        </p>
      )}
    </section>
  );
}

function EvidenceImage({ label, path, highlight = false }: { label: string; path: string; highlight?: boolean }) {
  const [broken, setBroken] = useState(false);
  return (
    <figure
      className={cn(
        "overflow-hidden rounded border",
        highlight
          ? "border-red-500/70 ring-2 ring-red-500/50"
          : "border-border",
      )}
      data-highlight={highlight || undefined}
    >
      {broken ? (
        <div className="flex h-20 flex-col items-center justify-center gap-1 bg-secondary/40 px-1 text-center">
          <ImageOff className="h-4 w-4 text-muted-foreground/60" />
          <span className="break-all font-mono text-[9px] leading-tight text-muted-foreground/80">{path}</span>
        </div>
      ) : (
        <img
          src={path}
          alt={`${label} screenshot (${path})`}
          className="h-20 w-full bg-secondary/40 object-cover"
          onError={() => setBroken(true)}
        />
      )}
      <figcaption
        className={cn(
          "px-1.5 py-1 font-mono text-[9.5px]",
          highlight ? "bg-red-500/10 text-red-300" : "bg-secondary/30 text-muted-foreground",
        )}
      >
        {label}
        {highlight ? " · changed" : ""}
      </figcaption>
    </figure>
  );
}
