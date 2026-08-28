import { useCallback, useEffect, useMemo, useState } from "react";
import type { ConnectionState, GenerationPrefs, Model } from "@/types";
import { DEFAULT_GEN_PREFS } from "@/types";
import { DEFAULT_BASE_URL, fetchModels, validateKey } from "@/lib/nanogpt";
import { FALLBACK_MODELS } from "@/lib/catalog";

const LS_KEY = "nanoforge.connection";
const LS_GENPREFS_KEY = "nanoforge.genprefs";

export function loadConnection(): ConnectionState {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as { apiKey?: string; baseUrl?: string };
      // Scrub legacy plain-text apiKey from localStorage if found
      if (saved.apiKey) {
        try {
          localStorage.setItem(LS_KEY, JSON.stringify({ baseUrl: saved.baseUrl ?? DEFAULT_BASE_URL }));
        } catch {}
      }
      return {
        apiKey: "",
        baseUrl: saved.baseUrl ?? DEFAULT_BASE_URL,
        status: "disconnected",
        liveModels: false,
      };
    }
  } catch {
    /* ignore parse errors */
  }
  return { apiKey: "", baseUrl: DEFAULT_BASE_URL, status: "disconnected", liveModels: false };
}

export function loadGenPrefs(): Record<string, GenerationPrefs> {
  try {
    const raw = localStorage.getItem(LS_GENPREFS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, Partial<GenerationPrefs>>;
    if (typeof parsed !== "object" || parsed === null) return {};
    const out: Record<string, GenerationPrefs> = {};
    for (const [modelId, p] of Object.entries(parsed)) {
      if (p && typeof p.temperature === "number" && typeof p.maxTokens === "number") {
        out[modelId] = { temperature: p.temperature, maxTokens: p.maxTokens };
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function useConnectionManager() {
  const [connection, setConnection] = useState<ConnectionState>(loadConnection);
  const [models, setModels] = useState<Model[]>(FALLBACK_MODELS);
  const [selectedModel, setSelectedModel] = useState<string>(FALLBACK_MODELS[3].id);
  const [genPrefsMap, setGenPrefsMap] = useState<Record<string, GenerationPrefs>>(loadGenPrefs);

  const genPrefs = useMemo(
    () => genPrefsMap[selectedModel] ?? DEFAULT_GEN_PREFS,
    [genPrefsMap, selectedModel],
  );

  const connected = connection.status === "connected";
  const model = useMemo(() => models.find((m) => m.id === selectedModel), [models, selectedModel]);

  const handleGenPrefsChange = useCallback(
    (p: GenerationPrefs) => {
      setGenPrefsMap((prev) => {
        const next = { ...prev, [selectedModel]: p };
        try {
          localStorage.setItem(LS_GENPREFS_KEY, JSON.stringify(next));
        } catch {
          /* quota / blocked storage */
        }
        return next;
      });
    },
    [selectedModel],
  );

  // Pull live catalog whenever connected
  useEffect(() => {
    if (!connected) return;
    fetchModels(connection.baseUrl, connection.apiKey).then((list) => {
      setModels(list);
      setConnection((c) => ({ ...c, liveModels: list.some((m) => m.live) }));
      if (!list.some((m) => m.id === selectedModel)) setSelectedModel(list[0].id);
    });
  }, [connected, connection.apiKey, connection.baseUrl, selectedModel]);

  const handleConnect = useCallback(async (apiKey: string, baseUrl: string) => {
    setConnection((c) => ({ ...c, apiKey, baseUrl, status: "checking", error: undefined, x402: undefined }));
    const result = await validateKey(baseUrl, apiKey);
    const status = result.ok ? "connected" : "error";
    setConnection({ apiKey, baseUrl, status, error: result.error, liveModels: false, x402: result.x402 });
    if (result.ok) {
      try {
        localStorage.setItem(LS_KEY, JSON.stringify({ baseUrl }));
      } catch {
        /* storage quota / blocked */
      }
    }
  }, []);

  const handleDisconnect = useCallback(() => {
    try {
      localStorage.removeItem(LS_KEY);
    } catch {
      /* ignore */
    }
    setConnection({ apiKey: "", baseUrl: DEFAULT_BASE_URL, status: "disconnected", liveModels: false });
    setModels(FALLBACK_MODELS);
  }, []);

  return {
    connection,
    setConnection,
    models,
    setModels,
    selectedModel,
    setSelectedModel,
    genPrefs,
    handleGenPrefsChange,
    connected,
    model,
    handleConnect,
    handleDisconnect,
  };
}
