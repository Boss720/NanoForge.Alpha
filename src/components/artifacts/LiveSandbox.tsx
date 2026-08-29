import { useState, useRef, useEffect } from "react";
import { Smartphone, Tablet, Monitor, Maximize2, RotateCw, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";

interface LiveSandboxProps {
  html: string;
  title?: string;
  className?: string;
}

export function LiveSandbox({ html, title = "Live Sandbox Preview", className = "" }: LiveSandboxProps) {
  const [device, setDevice] = useState<"responsive" | "mobile" | "tablet" | "desktop">("responsive");
  const [reloadKey, setReloadKey] = useState(0);
  const [sandboxError, setSandboxError] = useState<string | null>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Generate safe HTML with Tailwind CSS and error tracking
  const srcDoc = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>${title}</title>
      <script src="https://cdn.tailwindcss.com"></script>
      <script>
        tailwind.config = {
          darkMode: 'class',
          theme: {
            extend: {
              colors: {
                border: "hsl(214.3 31.8% 91.4%)",
                background: "hsl(0 0% 100%)",
                foreground: "hsl(222.2 84% 4.9%)",
                primary: "hsl(221.2 83.2% 53.3%)",
              }
            }
          }
        }
      </script>
      <style>
        body { margin: 0; padding: 1rem; font-family: ui-sans-serif, system-ui, sans-serif; }
      </style>
      <script>
        window.onerror = function(msg, url, lineNo, columnNo, error) {
          window.parent.postMessage({ type: 'SANDBOX_ERROR', message: msg + ' (line ' + lineNo + ')' }, '*');
          return false;
        };
      </script>
    </head>
    <body>
      ${html}
    </body>
    </html>
  `;

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data?.type === "SANDBOX_ERROR") {
        setSandboxError(event.data.message);
      }
    };
    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const handleOpenExternal = () => {
    const blob = new Blob([srcDoc], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
  };

  const getContainerWidth = () => {
    switch (device) {
      case "mobile":
        return "max-w-[375px] h-[667px]";
      case "tablet":
        return "max-w-[768px] h-[800px]";
      case "desktop":
        return "max-w-[1024px] h-[720px]";
      default:
        return "w-full h-full";
    }
  };

  return (
    <div className={`flex h-full flex-col overflow-hidden rounded-md border border-border bg-card ${className}`}>
      {/* Sandbox Header Bar */}
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-border bg-secondary/40 px-3">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[12px] font-medium text-foreground">{title}</span>
          <span className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] text-primary">
            Sandboxed
          </span>
        </div>

        {/* Device Switcher & Actions */}
        <div className="flex items-center gap-1.5">
          <div className="flex items-center rounded-md border border-border/60 bg-background/60 p-0.5">
            <Button
              variant={device === "responsive" ? "secondary" : "ghost"}
              size="icon"
              className="h-5 w-5 rounded-sm p-0"
              title="Responsive View"
              onClick={() => setDevice("responsive")}
            >
              <Maximize2 className="h-3 w-3" />
            </Button>
            <Button
              variant={device === "mobile" ? "secondary" : "ghost"}
              size="icon"
              className="h-5 w-5 rounded-sm p-0"
              title="Mobile (375px)"
              onClick={() => setDevice("mobile")}
            >
              <Smartphone className="h-3 w-3" />
            </Button>
            <Button
              variant={device === "tablet" ? "secondary" : "ghost"}
              size="icon"
              className="h-5 w-5 rounded-sm p-0"
              title="Tablet (768px)"
              onClick={() => setDevice("tablet")}
            >
              <Tablet className="h-3 w-3" />
            </Button>
            <Button
              variant={device === "desktop" ? "secondary" : "ghost"}
              size="icon"
              className="h-5 w-5 rounded-sm p-0"
              title="Desktop (1024px)"
              onClick={() => setDevice("desktop")}
            >
              <Monitor className="h-3 w-3" />
            </Button>
          </div>

          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-foreground"
            title="Reload Preview"
            onClick={() => {
              setSandboxError(null);
              setReloadKey((k) => k + 1);
            }}
          >
            <RotateCw className="h-3.5 w-3.5" />
          </Button>

          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-muted-foreground hover:text-foreground"
            title="Open in new window"
            onClick={handleOpenExternal}
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Error Alert if any */}
      {sandboxError && (
        <div className="flex items-center justify-between border-b border-rose-500/30 bg-rose-500/10 px-3 py-1 text-[11px] text-rose-400">
          <span>Sandbox Error: {sandboxError}</span>
          <button
            onClick={() => setSandboxError(null)}
            className="text-rose-400 hover:text-rose-200"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Frame Container */}
      <div className="flex flex-1 items-center justify-center overflow-auto bg-black/20 p-3">
        <div
          className={`overflow-hidden rounded-md border border-border bg-white shadow-md transition-all duration-200 ${getContainerWidth()}`}
        >
          <iframe
            key={reloadKey}
            ref={iframeRef}
            srcDoc={srcDoc}
            title={title}
            className="h-full w-full border-0 bg-white"
            sandbox="allow-scripts allow-forms"
          />
        </div>
      </div>
    </div>
  );
}
