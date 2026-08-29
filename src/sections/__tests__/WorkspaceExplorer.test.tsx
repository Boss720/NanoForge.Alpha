// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { WorkspaceExplorer } from "@/sections/WorkspaceExplorer";

afterEach(cleanup);

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverStub);

describe("WorkspaceExplorer", () => {
  it("is reachable with lazy files, refresh, and an attachment callback", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onAttach = vi.fn();
    const onRefresh = vi.fn();
    render(<WorkspaceExplorer
      tree={[{ name: "src", path: "src", isDir: true, children: [{ name: "main.ts", path: "src/main.ts", isDir: false, size: 12 }] }]}
      onFileSelect={onSelect}
      onRefresh={onRefresh}
      onSearch={vi.fn()}
      onAttachToChat={onAttach}
      isConnected
    />);

    await user.click(screen.getByText("src"));
    await user.click(screen.getByText("main.ts"));
    expect(onSelect).toHaveBeenCalledWith("src/main.ts");
    await user.click(screen.getByTitle("Refresh Explorer"));
    expect(onRefresh).toHaveBeenCalledOnce();
  });
});
