import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle, RotateCcw, ChevronDown, ChevronRight, RefreshCw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface ErrorBoundaryProps {
  children: ReactNode;
  panelName?: string;
  fallback?: ReactNode | ((props: { error: Error; resetErrorBoundary: () => void; panelName?: string }) => ReactNode);
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  onReset?: () => void;
  className?: string;
}

export interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  showDetails: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
      showDetails: false,
    };
  }

  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo });
    this.props.onError?.(error, errorInfo);
    console.error(`[ErrorBoundary:${this.props.panelName ?? "unnamed"}] Render crash:`, error, errorInfo);
  }

  resetErrorBoundary = (): void => {
    this.props.onReset?.();
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      showDetails: false,
    });
  };

  render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const { error, errorInfo, showDetails } = this.state;
    const { panelName = "Component", fallback, className = "" } = this.props;

    if (typeof fallback === "function") {
      return fallback({
        error: error ?? new Error("Unknown error"),
        resetErrorBoundary: this.resetErrorBoundary,
        panelName,
      });
    }

    if (fallback) {
      return fallback;
    }

    return (
      <div
        data-testid={`error-boundary-${panelName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`}
        className={`flex h-full min-h-[160px] w-full flex-col items-center justify-center rounded-lg border border-destructive/40 bg-card/60 p-6 text-card-foreground shadow-sm ${className}`}
      >
        <div className="flex max-w-md flex-col items-center text-center">
          <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <h3 className="font-mono text-sm font-semibold tracking-wide text-foreground">
            {panelName} Failed to Render
          </h3>
          <p className="mt-1 font-mono text-xs text-muted-foreground">
            {error?.message || "An unexpected rendering exception occurred."}
          </p>

          <div className="mt-4 flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={this.resetErrorBoundary}
              className="gap-1.5 font-mono text-xs"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              Retry Component
            </Button>
            {error?.stack && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => this.setState({ showDetails: !showDetails })}
                className="gap-1 font-mono text-xs text-muted-foreground hover:text-foreground"
              >
                {showDetails ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                {showDetails ? "Hide Stack" : "Show Stack"}
              </Button>
            )}
          </div>

          {showDetails && error?.stack && (
            <pre className="scrollbar-thin mt-4 max-h-40 w-full overflow-auto rounded bg-black/50 p-2.5 text-left font-mono text-[11px] text-destructive/80">
              {error.stack}
              {errorInfo?.componentStack && `\n\nComponent Stack:\n${errorInfo.componentStack}`}
            </pre>
          )}
        </div>
      </div>
    );
  }
}

/**
 * Root-level full viewport error boundary with global application recovery actions.
 */
export function AppErrorBoundary({ children }: { children: ReactNode }) {
  return (
    <ErrorBoundary
      panelName="NanoForge Application"
      fallback={({ error, resetErrorBoundary }) => (
        <div className="flex h-screen w-screen flex-col items-center justify-center bg-background p-6 text-foreground">
          <div className="flex max-w-lg flex-col items-center rounded-xl border border-border bg-card p-8 text-center shadow-xl">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-destructive/15 text-destructive">
              <AlertTriangle className="h-8 w-8" />
            </div>
            <h1 className="font-mono text-base font-bold tracking-tight">NanoForge Workbench Crash</h1>
            <p className="mt-2 font-mono text-xs text-muted-foreground">
              A fatal error occurred in the React application root:
            </p>
            <div className="mt-3 w-full rounded border border-destructive/20 bg-black/40 p-3 text-left font-mono text-[12px] text-destructive">
              {error.message || "Unknown root exception"}
            </div>

            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <Button
                onClick={resetErrorBoundary}
                variant="default"
                className="gap-2 font-mono text-xs"
              >
                <RotateCcw className="h-4 w-4" />
                Try Re-mounting
              </Button>
              <Button
                onClick={() => window.location.reload()}
                variant="outline"
                className="gap-2 font-mono text-xs"
              >
                <RefreshCw className="h-4 w-4" />
                Reload Window
              </Button>
              <Button
                onClick={() => {
                  try { localStorage.clear(); } catch {}
                  window.location.reload();
                }}
                variant="destructive"
                className="gap-2 font-mono text-xs"
              >
                <Trash2 className="h-4 w-4" />
                Clear Local State &amp; Reset
              </Button>
            </div>
          </div>
        </div>
      )}
    >
      {children}
    </ErrorBoundary>
  );
}
