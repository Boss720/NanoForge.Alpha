import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  WorkspaceActivateResult,
  WorkspaceChooseResult,
  WorkspaceRecentListResult,
  WorkspaceRevealResult,
} from "@protocol/workspace";
import { WorkspaceBrokerClient, WorkspaceBrokerError } from "@/lib/workspaceBrokerClient";
import { getInMemoryLauncherSettings } from "@/lib/hostSession";

export type WorkspaceBrokerClientLike = Pick<WorkspaceBrokerClient, "activate" | "choose" | "listRecents"> & {
  reveal?: (workspaceId: string, relativePath: string) => Promise<WorkspaceRevealResult>;
};

export interface WorkspaceBrokerMetadata {
  /** The loopback launcher origin hosting the broker HTTP routes. Ephemeral; never persist it. */
  baseUrl?: string;
  token?: string;
  generation?: number;
}

export interface WorkspaceBrokerState {
  status: "ready" | "connecting" | "unavailable" | "unsupported";
  message?: string;
}

export interface UseWorkspaceBrokerOptions {
  /** Injectable for tests and future host-session handoff wiring. */
  client?: WorkspaceBrokerClientLike;
  /** Ephemeral launcher metadata. When omitted, the current launcher URL is inspected. */
  metadata?: WorkspaceBrokerMetadata | null;
}

let inMemoryBrokerMetadata: WorkspaceBrokerMetadata | null = null;

export function resetInMemoryBrokerMetadata(): void {
  inMemoryBrokerMetadata = null;
}

function scrubBrokerUrlParameters(): void {
  if (typeof window === "undefined" || !window.history?.replaceState) return;
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.has("token") || url.searchParams.has("hostPort") || url.searchParams.has("bootstrapToken")) {
      url.searchParams.delete("token");
      url.searchParams.delete("hostPort");
      url.searchParams.delete("bootstrapToken");
      const cleanUrl = url.pathname + (url.search ? url.search : "") + url.hash;
      window.history.replaceState({}, document.title, cleanUrl || "/");
    }
  } catch {
    // Ignore in non-browser/test environments
  }
}

function launcherMetadataFromLocation(): WorkspaceBrokerMetadata | null {
  if (inMemoryBrokerMetadata) return inMemoryBrokerMetadata;
  if (typeof window === "undefined") return null;
  const query = new URLSearchParams(window.location.search);
  const token = query.get("token") || query.get("bootstrapToken");
  // A token on its own is not enough: hostPort is the launcher contract and
  // avoids treating arbitrary embedded pages as privileged local launchers.
  if (token && query.get("hostPort")) {
    inMemoryBrokerMetadata = { baseUrl: window.location.origin, token };
    scrubBrokerUrlParameters();
    return inMemoryBrokerMetadata;
  }
  const hostSettings = getInMemoryLauncherSettings();
  if (hostSettings?.enabled && hostSettings.token && hostSettings.port) {
    inMemoryBrokerMetadata = { baseUrl: window.location.origin, token: hostSettings.token };
    return inMemoryBrokerMetadata;
  }
  return null;
}

function brokerErrorMessage(error: unknown): string {
  if (error instanceof WorkspaceBrokerError && error.code === "picker_cancelled") return "Folder selection cancelled.";
  if (error instanceof WorkspaceBrokerError && error.code === "access_denied") return "Access denied to the selected folder. Check file permissions.";
  if (error instanceof WorkspaceBrokerError && error.code === "root_too_broad") return "The selected folder is a filesystem root or too broad. Choose a project subfolder.";
  if (error instanceof WorkspaceBrokerError && error.code === "workspace_missing") return "The selected folder does not exist or has been moved.";
  if (error instanceof Error) return error.message;
  return "The local folder service could not complete that request.";
}

/** Staged progress through workspace switching. */
export type SwitchStage = "idle" | "choosing" | "validating" | "starting" | "loading" | "ready" | "error";

export function useWorkspaceBroker(options: UseWorkspaceBrokerOptions = {}) {
  const metadata = options.metadata === undefined ? launcherMetadataFromLocation() : options.metadata;
  const brokerBaseUrl = metadata?.baseUrl ?? "";
  const brokerToken = metadata?.token ?? "";
  const client = useMemo<WorkspaceBrokerClientLike | null>(() => {
    if (options.client) return options.client;
    if (!brokerToken || !brokerBaseUrl) return null;
    return new WorkspaceBrokerClient({ baseUrl: brokerBaseUrl, token: brokerToken });
  }, [brokerBaseUrl, brokerToken, options.client]);
  const [state, setState] = useState<WorkspaceBrokerState>(() => client
    ? { status: "ready" }
    : { status: "unsupported", message: "Open local folders from the NanoForge launcher." });
  const [recents, setRecents] = useState<WorkspaceRecentListResult["workspaces"]>([]);
  const [switchStage, setSwitchStage] = useState<SwitchStage>("idle");
  const [pendingSwitchTarget, setPendingSwitchTarget] = useState<string | null>(null);

  useEffect(() => {
    setState(client ? { status: "ready" } : { status: "unsupported", message: "Open local folders from the NanoForge launcher." });
  }, [client]);

  const listRecents = useCallback(async () => {
    if (!client) return [];
    try {
      const result = await client.listRecents();
      setRecents(result.workspaces);
      return result.workspaces;
    } catch (error) {
      setState({ status: "unavailable", message: brokerErrorMessage(error) });
      return [];
    }
  }, [client]);

  useEffect(() => { void listRecents(); }, [listRecents]);

  const choose = useCallback(async (): Promise<WorkspaceChooseResult | null> => {
    if (!client) {
      setState({ status: "unsupported", message: "Open local folders from the NanoForge launcher." });
      return null;
    }
    setSwitchStage("choosing");
    setState({ status: "connecting", message: "Waiting for the folder picker…" });
    try {
      const result = await client.choose();
      setSwitchStage("idle");
      setState({ status: "ready" });
      void listRecents();
      return result;
    } catch (error) {
      const cancelled = error instanceof WorkspaceBrokerError && error.code === "picker_cancelled";
      setSwitchStage(cancelled ? "idle" : "error");
      setState(cancelled ? { status: "ready", message: "Folder selection cancelled." } : { status: "unavailable", message: brokerErrorMessage(error) });
      return null;
    }
  }, [client, listRecents]);

  const activate = useCallback(async (workspaceId: string): Promise<WorkspaceActivateResult | null> => {
    if (!client) {
      setState({ status: "unsupported", message: "Open local folders from the NanoForge launcher." });
      return null;
    }
    setSwitchStage("validating");
    setState({ status: "connecting", message: "Validating folder…" });
    try {
      setSwitchStage("starting");
      setState({ status: "connecting", message: "Starting local tools…" });
      const result = await client.activate(workspaceId);
      setSwitchStage("loading");
      setState({ status: "connecting", message: "Loading files…" });
      // Allow a tick for the UI to render the loading stage
      await new Promise((resolve) => setTimeout(resolve, 0));
      setSwitchStage("ready");
      setState({ status: "ready" });
      void listRecents();
      return result;
    } catch (error) {
      setSwitchStage("error");
      setState({ status: "unavailable", message: brokerErrorMessage(error) });
      return null;
    }
  }, [client, listRecents]);

  const reveal = useCallback(async (workspaceId: string, relativePath: string): Promise<WorkspaceRevealResult> => {
    if (!client?.reveal) throw new WorkspaceBrokerError("This launcher cannot reveal paths.", "invalid_request");
    return client.reveal(workspaceId, relativePath);
  }, [client]);

  const confirmSwitch = useCallback(() => {
    const target = pendingSwitchTarget;
    setPendingSwitchTarget(null);
    if (target) void activate(target);
  }, [activate, pendingSwitchTarget]);

  const cancelSwitch = useCallback(() => {
    setPendingSwitchTarget(null);
  }, []);

  return {
    available: client !== null,
    state,
    recents,
    switchStage,
    pendingSwitchTarget,
    choose,
    activate,
    reveal,
    listRecents,
    setPendingSwitchTarget,
    confirmSwitch,
    cancelSwitch,
  };
}
