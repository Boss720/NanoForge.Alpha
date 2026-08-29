import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Session, UsageRun, UsageTotals, VirtualFile } from "@/types";
import {
  createDebouncedSaver,
  loadState,
  saveState,
  STATE_VERSION,
  STORAGE_KEY,
  type LegacyPersistedState,
  type StorageLike,
} from "@/lib/persist";

/** Minimal in-memory Storage stub (vitest runs with environment "node"). */
function makeStorage(initial: Record<string, string> = {}): StorageLike & {
  data: Record<string, string>;
  setItemCalls: number;
} {
  const store = {
    data: { ...initial },
    setItemCalls: 0,
    getItem(key: string) {
      return Object.prototype.hasOwnProperty.call(store.data, key) ? store.data[key] : null;
    },
    setItem(key: string, value: string) {
      store.setItemCalls++;
      store.data[key] = String(value);
    },
    removeItem(key: string) {
      delete store.data[key];
    },
  };
  return store;
}

function makeState(): Omit<LegacyPersistedState, "version"> {
  const sessions: Session[] = [
    {
      id: "s1",
      title: "Demo",
      model: "gpt-nano",
      createdAt: 1720000000000,
      messages: [{ id: "m1", role: "user", content: "hi", ts: 1720000000001 }],
    },
  ];
  const usage: UsageTotals = { input: 120, output: 45, costUsd: 0.0021, requests: 3 };
  const files: VirtualFile[] = [{ path: "src/server.ts", language: "ts", content: "// code" }];
  return { sessions, usage, files };
}

describe("saveState / loadState round-trip", () => {
  it("normalizes legacy session input under nanoforge.v1 with the current version", () => {
    const storage = makeStorage();
    const state = makeState();

    expect(saveState(state, storage)).toBe(true);

    const raw = storage.data[STORAGE_KEY];
    expect(raw).toBeDefined();
    expect(JSON.parse(raw).version).toBe(STATE_VERSION);

    const loaded = loadState(storage);
    expect(loaded).toMatchObject({
      version: STATE_VERSION,
      workspaces: [{ id: "workspace-default", chats: state.sessions }],
      activeWorkspaceId: "workspace-default",
      activeChatId: "s1",
      usage: state.usage,
      files: state.files,
    });
  });

  it("returns null when the key is missing", () => {
    expect(loadState(makeStorage())).toBeNull();
  });

  it("returns null on corrupted JSON (never throws)", () => {
    const storage = makeStorage({ [STORAGE_KEY]: "{not valid json!!!" });
    expect(loadState(storage)).toBeNull();
  });

  it("returns null on version mismatch (never throws)", () => {
    const storage = makeStorage();
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: 99, ...makeState() }));
    expect(loadState(storage)).toBeNull();
  });

  it("returns null when required fields have the wrong shape", () => {
    const storage = makeStorage();
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, sessions: "oops", usage: {}, files: [] }));
    expect(loadState(storage)).toBeNull();
  });

  it("returns null instead of throwing when storage itself throws", () => {
    const broken: StorageLike = {
      getItem() {
        throw new Error("blocked");
      },
      setItem() {
        throw new Error("quota");
      },
      removeItem() {},
    };
    expect(loadState(broken)).toBeNull();
    expect(saveState(makeState(), broken)).toBe(false);
  });
});

describe("persisted runs (cost dashboard, additive v1 field)", () => {
  const runs: UsageRun[] = [
    { id: "r1", ts: 1720000001000, modelId: "gpt-nano", input: 100, output: 40, costUsd: 0.001 },
    { id: "r2", ts: 1720000002000, modelId: "gpt-nano", input: 5, output: 0, costUsd: 0.0001, errored: true },
  ];

  it("round-trips runs through save/load", () => {
    const storage = makeStorage();
    const state = { ...makeState(), runs };
    expect(saveState(state, storage)).toBe(true);
    const loaded = loadState(storage);
    expect(loaded).toMatchObject({
      version: STATE_VERSION,
      workspaces: [{ id: "workspace-default", chats: state.sessions }],
      runs,
    });
    expect(loaded?.runs).toEqual(runs);
  });

  it("loads old saves WITHOUT a runs field — runs comes back undefined (callers default with ?? [])", () => {
    const storage = makeStorage();
    // Simulate a payload written before the runs field existed.
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, ...makeState() }));
    const loaded = loadState(storage);
    expect(loaded).not.toBeNull();
    expect(loaded?.runs).toBeUndefined();
    expect(loaded?.runs ?? []).toEqual([]); // documented consumer pattern
  });

  it("rejects payloads where runs is present but not an array", () => {
    const storage = makeStorage();
    storage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, ...makeState(), runs: "oops" }));
    expect(loadState(storage)).toBeNull();
  });

  it("passes runs through the debounced saver", () => {
    vi.useFakeTimers();
    try {
      const storage = makeStorage();
      const saver = createDebouncedSaver(500, storage);
      saver({ ...makeState(), runs });
      vi.advanceTimersByTime(500);
      expect(loadState(storage)?.runs).toEqual(runs);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("createDebouncedSaver", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("coalesces rapid calls into a single write with the latest state", () => {
    const storage = makeStorage();
    const saver = createDebouncedSaver(500, storage);

    saver({ ...makeState(), sessions: [] });
    saver({ ...makeState(), files: [] });
    saver(makeState()); // latest wins

    vi.advanceTimersByTime(499);
    expect(storage.setItemCalls).toBe(0);

    vi.advanceTimersByTime(1);
    expect(storage.setItemCalls).toBe(1);
    expect(loadState(storage)).toMatchObject({
      version: STATE_VERSION,
      workspaces: [{ id: "workspace-default", chats: makeState().sessions }],
    });
  });

  it("uses a 500ms delay by default", () => {
    const storage = makeStorage();
    const saver = createDebouncedSaver(undefined, storage);
    saver(makeState());
    vi.advanceTimersByTime(499);
    expect(storage.setItemCalls).toBe(0);
    vi.advanceTimersByTime(1);
    expect(storage.setItemCalls).toBe(1);
  });

  it("flush() writes the pending payload immediately", () => {
    const storage = makeStorage();
    const saver = createDebouncedSaver(500, storage);
    saver(makeState());
    saver.flush();
    expect(storage.setItemCalls).toBe(1);
    // The timer was cleared; nothing more fires later.
    vi.advanceTimersByTime(10_000);
    expect(storage.setItemCalls).toBe(1);
  });

  it("cancel() drops the pending payload", () => {
    const storage = makeStorage();
    const saver = createDebouncedSaver(500, storage);
    saver(makeState());
    saver.cancel();
    vi.advanceTimersByTime(10_000);
    expect(storage.setItemCalls).toBe(0);
  });
});

describe("workspace migration", () => {
  it("migrates the legacy flat sessions payload into a default workspace", () => {
    const storage = makeStorage({
      [STORAGE_KEY]: JSON.stringify({ version: 1, ...makeState() }),
    });

    const loaded = loadState(storage);

    expect(loaded?.version).toBe(STATE_VERSION);
    expect(loaded?.workspaces).toHaveLength(1);
    expect(loaded?.workspaces[0]).toMatchObject({
      id: "workspace-default",
      name: "Default workspace",
      chats: makeState().sessions,
    });
    expect(loaded?.activeWorkspaceId).toBe("workspace-default");
    expect(loaded?.activeChatId).toBe("s1");
  });

  it("validates a new workspace payload without throwing", () => {
    const storage = makeStorage();
    const state = {
      workspaces: [
        {
          id: "w1",
          name: "Work",
          createdAt: 1720000000000,
          chats: makeState().sessions,
        },
      ],
      activeWorkspaceId: "w1",
      activeChatId: "s1",
      usage: makeState().usage,
      files: makeState().files,
    };

    expect(saveState(state, storage)).toBe(true);
    expect(loadState(storage)).toMatchObject({ version: STATE_VERSION, ...state });
  });

  it("migrates version-2 workspace metadata without granting a filesystem root", () => {
    const storage = makeStorage({
      [STORAGE_KEY]: JSON.stringify({
        version: 2,
        workspaces: [{ id: "w1", name: "Work", createdAt: 1, chats: [], location: { kind: "local", hostWorkspaceId: "host-1", displayPath: "…/Work", lastOpenedAt: 1, rootPath: "C:\\private" } }],
        activeWorkspaceId: "w1",
        activeChatId: "",
        usage: { input: 0, output: 0, costUsd: 0, requests: 0 },
        files: [],
      }),
    });

    const loaded = loadState(storage);
    expect(loaded).toMatchObject({ version: STATE_VERSION, workspaces: [{ location: { hostWorkspaceId: "host-1", displayPath: "…/Work" } }] });
    expect(loaded?.workspaces[0].location).not.toHaveProperty("rootPath");
  });
});
