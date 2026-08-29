/**
 * Cross-platform process tree termination utility.
 *
 * Terminates a process and all its descendants on Windows (taskkill /T /F)
 * or POSIX (-PID process group SIGKILL).
 */

import type { CancellationToken } from "./types";

export interface ProcessLike {
  pid?: number;
  kill?(signal?: string | number): boolean | void;
  killed?: boolean;
}

export interface TerminateProcessOptions {
  timeoutMs?: number;
  gracePeriodMs?: number;
}

export async function terminateProcessTree(
  proc: ProcessLike | null | undefined,
  token?: CancellationToken,
  options: TerminateProcessOptions = {}
): Promise<boolean> {
  if (!proc) return true;
  token?.throwIfCancelled();

  const pid = proc.pid;
  if (!pid || pid <= 0) {
    if (typeof proc.kill === "function") {
      try {
        proc.kill("SIGKILL");
        return true;
      } catch {
        return false;
      }
    }
    return true;
  }

  const isWindows = typeof process !== "undefined" && process.platform === "win32";

  if (isWindows) {
    return new Promise<boolean>((resolve) => {
      import("child_process")
        .then(({ exec }) => {
          exec(`taskkill /pid ${pid} /T /F`, { windowsHide: true }, (err) => {
            if (err) {
              // If taskkill fails, try fallback kill
              if (typeof proc.kill === "function") {
                try {
                  proc.kill();
                } catch {
                  // Ignore
                }
              }
            }
            resolve(true);
          });
        })
        .catch(() => {
          if (typeof proc.kill === "function") {
            try {
              proc.kill();
            } catch {
              // Ignore
            }
          }
          resolve(true);
        });
    });
  } else {
    // POSIX process group termination
    try {
      if (typeof process !== "undefined" && typeof process.kill === "function") {
        try {
          process.kill(-pid, "SIGTERM");
        } catch {
          try {
            process.kill(pid, "SIGTERM");
          } catch {
            // Process may already be dead
          }
        }

        const grace = options.gracePeriodMs ?? 50;
        await new Promise((resolve) => setTimeout(resolve, grace));

        try {
          process.kill(-pid, "SIGKILL");
        } catch {
          try {
            process.kill(pid, "SIGKILL");
          } catch {
            // Process already dead
          }
        }
      } else if (typeof proc.kill === "function") {
        proc.kill("SIGKILL");
      }
      return true;
    } catch {
      if (typeof proc.kill === "function") {
        try {
          proc.kill("SIGKILL");
        } catch {
          // Ignore
        }
      }
      return true;
    }
  }
}
