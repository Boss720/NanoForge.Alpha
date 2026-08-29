// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChatPanel } from "@/sections/ChatPanel";

afterEach(cleanup);

const model = { id: "m", name: "Model", provider: "test", inputPrice: 0, outputPrice: 0, contextK: 128, tags: [] };

describe("ChatPanel attachment forwarding", () => {
  it("forwards @file selections as a typed attachment send payload", async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(
      <ChatPanel
        messages={[]}
        running={false}
        model={model}
        connected={false}
        onSend={onSend}
        onStop={vi.fn()}
        onPatchDecision={vi.fn()}
        genPrefs={{ temperature: 0.3, maxTokens: 256 }}
        onGenPrefsChange={vi.fn()}
        workspaceFiles={[{ path: "src/attached.ts", language: "typescript", content: "export const value = 1;" }]}
      />,
    );
    const textarea = screen.getByTestId("chat-textarea");
    await user.type(textarea, "@attached{Enter}");
    await user.type(textarea, "Review this{Enter}");
    expect(onSend).toHaveBeenCalledWith(expect.objectContaining({
      text: "Review this",
      attachments: [expect.objectContaining({ source: "workspace", relativePath: "src/attached.ts" })],
    }));
  });

  it("renders saved attachment metadata without exposing snapshot content", () => {
    render(
      <ChatPanel
        messages={[{
          id: "user-1", role: "user", content: "Review the file", ts: 1,
          attachments: [{
            id: "a-1", type: "file", source: "workspace", name: "gone.ts", relativePath: "src/gone.ts",
            mimeType: "text/typescript", language: "typescript", byteSize: 12, snapshotId: "missing", status: "missing",
          }],
        }]}
        running={false}
        model={model}
        connected={false}
        onSend={vi.fn()}
        onStop={vi.fn()}
        onPatchDecision={vi.fn()}
        genPrefs={{ temperature: 0.3, maxTokens: 256 }}
        onGenPrefsChange={vi.fn()}
      />,
    );
    expect(screen.getByTestId("message-attachments").textContent).toMatch(/src\/gone\.ts.*snapshot unavailable/i);
  });
});
