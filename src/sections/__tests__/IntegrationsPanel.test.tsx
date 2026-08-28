// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  IntegrationsPanel,
  type IntegrationsPanelProps,
  type McpServerRow,
  type RulesPackRow,
  type SkillRow,
} from "../IntegrationsPanel";

afterEach(cleanup);

const rulesPacks: RulesPackRow[] = [
  {
    id: "default",
    name: "Default rules",
    enabled: true,
    health: "ok",
    source: "global",
    digest: "sha256:9f2c1ab7e4",
    priority: 10,
  },
  {
    id: "webapp",
    name: "Webapp rules",
    enabled: false,
    health: "error",
    lastError: "glob parse error at line 4",
    source: "project",
    digest: "sha256:11aa22bb33",
  },
];

const skills: SkillRow[] = [
  {
    id: "pr-review",
    name: "PR Review",
    description: "Reviews pull requests against house style.",
    allowedTools: ["read_file", "search"],
    instructions: "1. Read the diff.\n2. Check style.\n3. Comment.",
    hashValid: true,
    enabled: false,
    health: "ok",
  },
  {
    id: "tampered",
    name: "Tampered skill",
    description: "Hash does not match the manifest.",
    allowedTools: ["run_command"],
    instructions: "do things",
    hashValid: false,
    enabled: false,
    health: "unknown",
  },
];

const mcpServers: McpServerRow[] = [
  {
    id: "github",
    name: "GitHub MCP",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-github"],
    tools: ["mcp.github.create_issue", "mcp.github.search_issues"],
    secretRefs: ["env:GITHUB_TOKEN"],
    enabled: true,
    health: "ok",
  },
];

function renderPanel(overrides: Partial<IntegrationsPanelProps> = {}) {
  const props: IntegrationsPanelProps = {
    plugins: [],
    rulesPacks,
    skills,
    mcpServers,
    onToggleRulesPack: vi.fn(),
    onToggleSkill: vi.fn(),
    onToggleMcpServer: vi.fn(),
    onTogglePlugin: vi.fn(),
    ...overrides,
  };
  render(<IntegrationsPanel {...props} />);
  return props;
}

const rowOf = (id: string) => {
  const el = document.querySelector(`[data-integration-id="${id}"]`);
  if (!el) throw new Error(`row ${id} not found`);
  return within(el as HTMLElement);
};

describe("IntegrationsPanel", () => {
  it("renders the tabs and can navigate between sections", async () => {
    const user = userEvent.setup();
    renderPanel();
    
    // Default tab is plugins
    expect(screen.getByRole("tab", { name: "Plugins" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Skills" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "MCP Servers" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Governance Rules" })).toBeInTheDocument();

    // Click Governance Rules tab
    await user.click(screen.getByRole("tab", { name: "Governance Rules" }));
    expect(screen.getByRole("region", { name: "Rules packs" })).toBeInTheDocument();

    const rules = rowOf("webapp");
    expect(rules.getByText("Webapp rules")).toBeInTheDocument();
    expect(rules.getByText("glob parse error at line 4")).toBeInTheDocument();
    expect(rules.getByText("project")).toBeInTheDocument();
    expect(rules.getByText(/^sha256:/)).toBeInTheDocument();

    // Click MCP Servers tab
    await user.click(screen.getByRole("tab", { name: "MCP Servers" }));
    const mcp = rowOf("github");
    expect(mcp.getByText(/@modelcontextprotocol\/server-github/)).toBeInTheDocument();
    expect(mcp.getByText("mcp.github.create_issue")).toBeInTheDocument();
  });

  it("toggles a rules pack via callback", async () => {
    const user = userEvent.setup();
    const props = renderPanel();
    await user.click(screen.getByRole("tab", { name: "Governance Rules" }));
    await user.click(rowOf("webapp").getByRole("switch", { name: "enable Webapp rules" }));
    expect(props.onToggleRulesPack).toHaveBeenCalledWith("webapp", true);
  });

  it("skill enable switch stays disabled until instructions are viewed", async () => {
    const user = userEvent.setup();
    const props = renderPanel();
    await user.click(screen.getByRole("tab", { name: "Skills" }));
    const row = rowOf("pr-review");
    const toggle = row.getByRole("switch", { name: "enable PR Review" });

    // gated before viewing instructions
    expect(toggle).toBeDisabled();
    expect(row.queryByText("1. Read the diff.")).not.toBeInTheDocument();

    // expand instructions → gate lifts
    await user.click(row.getByRole("button", { name: "view instructions" }));
    expect(row.getByText(/1\. Read the diff\./)).toBeInTheDocument();
    expect(toggle).toBeEnabled();

    await user.click(toggle);
    expect(props.onToggleSkill).toHaveBeenCalledWith("pr-review", true);
  });

  it("skill with invalid hash can never be enabled, even after viewing instructions", async () => {
    const user = userEvent.setup();
    const props = renderPanel();
    await user.click(screen.getByRole("tab", { name: "Skills" }));
    const row = rowOf("tampered");
    await user.click(row.getByRole("button", { name: "view instructions" }));
    expect(row.getByText("hash mismatch")).toBeInTheDocument();
    expect(row.getByRole("switch", { name: "enable Tampered skill" })).toBeDisabled();
    expect(props.onToggleSkill).not.toHaveBeenCalled();
  });

  it("renders secret references by name only — no secret-looking value reaches the DOM", async () => {
    const user = userEvent.setup();
    renderPanel();
    await user.click(screen.getByRole("tab", { name: "MCP Servers" }));
    const panel = screen.getByTestId("integrations-panel");

    // the opaque reference name IS shown
    expect(panel).toHaveTextContent("env:GITHUB_TOKEN");

    // and no secret-shaped value appears anywhere in the panel
    const text = panel.textContent ?? "";
    const secretPatterns = [
      /ghp_[A-Za-z0-9]{20,}/, // GitHub PAT
      /github_pat_[A-Za-z0-9_]{20,}/, // fine-grained PAT
      /sk-[A-Za-z0-9]{20,}/, // OpenAI-style key
      /xox[baprs]-[A-Za-z0-9-]{10,}/, // Slack tokens
      /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    ];
    for (const pattern of secretPatterns) {
      expect(text).not.toMatch(pattern);
    }
  });

  it("mcp toggle callback fires with the server id", async () => {
    const user = userEvent.setup();
    const props = renderPanel();
    await user.click(screen.getByRole("tab", { name: "MCP Servers" }));
    await user.click(rowOf("github").getByRole("switch", { name: "enable GitHub MCP" }));
    expect(props.onToggleMcpServer).toHaveBeenCalledWith("github", false);
  });

  it("renders empty sections cleanly", async () => {
    const user = userEvent.setup();
    renderPanel({ rulesPacks: [], skills: [], mcpServers: [] });
    await user.click(screen.getByRole("tab", { name: "Governance Rules" }));
    expect(screen.getByText("none configured")).toBeInTheDocument();
  });
});
