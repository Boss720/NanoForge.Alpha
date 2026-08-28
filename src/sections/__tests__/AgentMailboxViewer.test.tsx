// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

afterEach(cleanup);
import { AgentMailboxViewer, parseHandoffReport } from "../subagents/AgentMailboxViewer";
import type { SubagentInfo, SubagentMessage } from "@protocol/subagents";

const mockSubagents: SubagentInfo[] = [
  {
    id: "agent-1",
    name: "Worker Implementer",
    parentId: null,
    archetype: "implementer",
    roles: ["developer"],
    state: "running",
    isolationMode: "inherit",
    startedAt: "2026-08-15T00:00:00Z",
    lastHeartbeat: "2026-08-15T00:01:00Z",
    tokensUsed: 1000,
    turnCount: 1,
    workingDirectory: "/workspace",
  },
  {
    id: "agent-2",
    name: "QA Verifier",
    parentId: null,
    archetype: "qa",
    roles: ["tester"],
    state: "running",
    isolationMode: "inherit",
    startedAt: "2026-08-15T00:00:00Z",
    lastHeartbeat: "2026-08-15T00:01:00Z",
    tokensUsed: 1000,
    turnCount: 1,
    workingDirectory: "/workspace",
  },
];

const handoffBody = `
## 1. Observation
Found missing import in src/App.tsx line 42.

## 2. Logic Chain
The component needs the subagent dock to render, so importing it fixes the reference.

## 3. Caveats
Did not check legacy mobile CSS.

## 4. Conclusion
Fix is ready and verified.

## 5. Verification Method
Run npm test to verify.
`;

const mockMessages: SubagentMessage[] = [
  {
    messageId: "msg-1",
    senderId: "agent-1",
    senderName: "Worker Implementer",
    recipientId: "agent-2",
    subject: "Handoff Report Milestone 3",
    body: handoffBody,
    timestamp: new Date().toISOString(),
    priority: "high",
    referencedArtifacts: ["src/App.tsx", "src/sections/SubagentsPanel.tsx"],
  },
  {
    messageId: "msg-2",
    senderId: "agent-2",
    senderName: "QA Verifier",
    recipientId: "agent-1",
    subject: "Ack",
    body: "Looks good, running verification suite now.",
    timestamp: new Date().toISOString(),
    priority: "normal",
    referencedArtifacts: [],
  },
];

describe("AgentMailboxViewer Component", () => {
  it("parses 5-component handoff report correctly", () => {
    const parsed = parseHandoffReport(handoffBody);
    expect(parsed.isHandoff).toBe(true);
    expect(parsed.observation).toContain("Found missing import");
    expect(parsed.logicChain).toContain("The component needs");
    expect(parsed.caveats).toContain("Did not check legacy");
    expect(parsed.conclusion).toContain("Fix is ready");
    expect(parsed.verificationMethod).toContain("Run npm test");
  });

  it("renders messages with sender, recipient, and 5-component handoff sections", () => {
    const onSend = vi.fn().mockResolvedValue({});
    const onSelectArtifact = vi.fn();

    render(
      <AgentMailboxViewer
        messages={mockMessages}
        subagents={mockSubagents}
        onSendMessage={onSend}
        onSelectArtifact={onSelectArtifact}
      />
    );

    expect(screen.getAllByText("Worker Implementer").length).toBeGreaterThan(0);
    expect(screen.getAllByText("QA Verifier").length).toBeGreaterThan(0);
    expect(screen.getByText("Handoff Report Milestone 3")).toBeDefined();
    expect(screen.getByText("1. Observation")).toBeDefined();
    expect(screen.getByText("2. Logic Chain")).toBeDefined();
    expect(screen.getByText("4. Conclusion")).toBeDefined();
    expect(screen.getByText("5. Verification Method")).toBeDefined();
  });

  it("clicks artifact chips and triggers onSelectArtifact", () => {
    const onSend = vi.fn().mockResolvedValue({});
    const onSelectArtifact = vi.fn();

    render(
      <AgentMailboxViewer
        messages={mockMessages}
        subagents={mockSubagents}
        onSendMessage={onSend}
        onSelectArtifact={onSelectArtifact}
      />
    );

    const artifactChip = screen.getByText("src/App.tsx");
    fireEvent.click(artifactChip);

    expect(onSelectArtifact).toHaveBeenCalledWith("src/App.tsx");
  });

  it("submits quick-reply composer and triggers onSendMessage", async () => {
    const onSend = vi.fn().mockResolvedValue({});

    render(
      <AgentMailboxViewer
        messages={mockMessages}
        subagents={mockSubagents}
        onSendMessage={onSend}
      />
    );

    const select = screen.getByLabelText(/Select recipient/i);
    fireEvent.change(select, { target: { value: "agent-2" } });

    const textarea = screen.getByPlaceholderText(/Write message or directive/i);
    fireEvent.change(textarea, { target: { value: "Please verify PR #45" } });

    const submitBtn = screen.getByRole("button", { name: /Send/i });
    fireEvent.click(submitBtn);

    expect(onSend).toHaveBeenCalledWith("agent-2", "Please verify PR #45", {
      subject: "Direct Message",
      priority: "normal",
    });
  });
});
