import { describe, expect, it } from "vitest";
import { MemoryAttachmentSnapshotStore } from "@/lib/attachments/snapshots";

describe("MemoryAttachmentSnapshotStore", () => {
  it("stores, overwrites, and removes snapshots deterministically", async () => {
    const store = new MemoryAttachmentSnapshotStore();
    await store.save("one", "first");
    await store.save("one", "second");
    await store.remove("one");
    expect(await store.load("one")).toBeUndefined();
  });

  it("clears all stored snapshots and returns active keys", async () => {
    const store = new MemoryAttachmentSnapshotStore();
    await store.save("snap-1", "content 1");
    await store.save("snap-2", "content 2");
    expect(await store.keys?.()).toEqual(["snap-1", "snap-2"]);
    await store.clear();
    expect(await store.load("snap-1")).toBeUndefined();
    expect(await store.keys?.()).toEqual([]);
  });
});
