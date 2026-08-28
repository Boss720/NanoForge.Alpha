// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkspaceExplorer } from …60948 tokens truncated…        />
                    <div className="leading-tight">
                      <div className="font-semibold text-[11px]">{tool.name}</div>
                      <div className="text-[9px] text-muted-foreground">{tool.description}</div>
                    </div>
                  </label>
                );
              })}
            </div>
          </div>

          {/* Resource Limits */}
          <div className="grid grid-cols-3 gap-3 pt-1">
            <div>
              <label className="block font-semibold text-foreground mb-1">
                Concurrency
              </label>
              <Input
                data-testid="launch-concurrency"
                type="number"
                value={concurrency}
                onChange={(e) => setConcurrency(parseInt(e.target.value, 10) || 0)}
                min={1}
                max={MAX_CONCURRENT_SUBAGENTS}
                className="h-8 font-mono text-xs bg-background"
              />
              <span className="text-[9px] text-muted-foreground">{activeCount}/{MAX_CONCURRENT_SUBAGENTS} active</span>
            </div>
            <div>
              <label className="block font-semibold text-foreground mb-1">
                Timeout: {timeoutSeconds}s ({Math.floor(timeoutSeconds / 60)} min)
              </label>
              <input
                type="range"
                min={60}
                max={3600}
                step={60}
                value={timeoutSeconds}
                onChange={(e) => setTimeoutSeconds(parseInt(e.target.value, 10))}
                className="w-full h-1.5 bg-secondary rounded-lg appearance-none cursor-pointer accent-primary"
              />
            </div>

            <div>
              <label className="block font-semibold text-foreground mb-1">
                Token Budget
              </label>
              <Input
                type="number"
                value={budgetTokens}
                onChange={(e) => setBudgetTokens(e.target.value)}
                placeholder="50000"
                min={1000}
                className="h-8 font-mono text-xs bg-background"
              />
            </div>
          </div>

          <div data-testid="dry-run-preview" className="rounded border border-primary/20 bg-primary/5 p-2.5 text-[10px] text-muted-foreground">
            <div className="flex items-center justify-between gap-2 mb-1">
              <span className="font-semibold text-primary">Dry-run launch preview</span>
              <Badge variant="outline" className="text-[9px]">No host call yet</Badge>
            </div>
            <p className="leading-relaxed">
              {concurrency} {concurrency === 1 ? "agent" : "agents"} · {archetype} · {roles.length ? roles.join(", ") : "no role"} · {formatLaunchIsolation(workspaceIsolation)} · {budgetTokens || "—"} tokens · {timeoutSeconds}s
            </p>
            <p className="mt-1 text-foreground/80">Review the mission and settings above, then use the explicit confirmation action to spawn.</p>
          </div>

          {/* Form Actions */}
          <div className="flex justify-end gap-2 pt-3 border-t border-border">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              size="sm"
              disabled={isSubmitting || isDepthExceeded || launchErrors.length > 0}
              className="font-mono text-xs"
            >
              {isSubmitting ? "Spawning Subagent..." : "Confirm & Spawn Agent"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
