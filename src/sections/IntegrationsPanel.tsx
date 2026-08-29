import { useState } from "react";
import { BookOpen, Hash, ScrollText, Server, Plug } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PluginManager } from "@/sections/PluginManager";

/**
 * Agent platform — Module 4, Task 14 (UI half).
 *
 * Settings surface for the three integration kinds the local agent host
 * manages: rules packs, skills, and MCP servers. Fully controlled: plain data
 * arrays in, toggle callbacks out; nothing here talks to the host directly.
 *
 * Two safety behaviors live IN this component by design:
 *  - A skill cannot be enabled until its instructions have been expanded and
 *    viewed (mirrors the host registry flow of Task 12), and never while its
 *    content hash is invalid.
 *  - Secrets exist only as opaque references (`env:GITHUB_TOKEN`). The row
 *    types have NO field that could carry a secret value, so nothing
 *    secret-looking can reach the DOM from here.
 */

export type IntegrationHealth = "ok" | "error" | "checking" | "unknown";

export interface RulesPackRow {
  id: string;
  name: string;
  enabled: boolean;
  health: IntegrationHealth;
  lastError?: string | null;
  /** Precedence scope, e.g. "global" | "project" | "run". */
  source: string;
  /** Context digest as reported by the host (shown truncated). */
  digest: string;
  priority?: number;
}

export interface SkillRow {
  id: string;
  name: string;
  description: string;
  /** Narrow tool allow-list from the skill manifest. */
  allowedTools: string[];
  /** Full instructions — rendered in the expandable "view instructions" panel. */
  instructions: string;
  /** false when the host reports a contentHash mismatch; enabling is blocked. */
  hashValid: boolean;
  enabled: boolean;
  health: IntegrationHealth;
  lastError?: string | null;
}

export interface McpServerRow {
  id: string;
  name: string;
  /** Approved executable, e.g. "npx". */
  command: string;
  args?: string[];
  /** Declared tools, namespaced as mcp.<server>.<tool>. */
  tools: string[];
  /** Opaque secret REFERENCE names only (e.g. "env:GITHUB_TOKEN") — never values. */
  secretRefs?: string[];
  enabled: boolean;
  health: IntegrationHealth;
  lastError?: string | null;
}

export type IntegrationKind = "rules" | "skill" | "mcp" | "plugin";

export interface PluginRow {
  id: string;
  name: string;
  enabled: boolean;
  health: IntegrationHealth;
  lastError?: string | null;
}

export interface IntegrationsPanelProps {

// plugins line duplicate removed
  plugins: PluginRow[];
  rulesPacks: RulesPackRow[];
  skills: SkillRow[];
  mcpServers: McpServerRow[];
  onToggleRulesPack: (id: string, enabled: boolean) => void;
  onToggleSkill: (id: string, enabled: boolean) => void;
  onToggleMcpServer: (id: string, enabled: boolean) => void;
  onTogglePlugin: (id: string, enabled: boolean) => void;
  /** Optional manual health re-check trigger per row. */
  onCheckHealth?: (kind: IntegrationKind, id: string) => void;
  className?: string;
}

export function IntegrationsPanel({
  plugins,
  rulesPacks,
  skills,
  mcpServers,
  onToggleRulesPack,
  onToggleSkill,
  onToggleMcpServer,
  onTogglePlugin,
  onCheckHealth,
  className,
}: IntegrationsPanelProps) {
  const activePlugins = plugins.filter(p => p.enabled).length;
  const activeSkills = skills.filter(s => s.enabled).length;
  const activeMcp = mcpServers.filter(m => m.enabled).length;
  const activeRules = rulesPacks.filter(r => r.enabled).length;

  return (
    <div className={cn("flex flex-col gap-4", className)} data-testid="integrations-panel">
      <div className="flex items-center gap-4 bg-muted/30 p-3 rounded-lg border text-sm font-mono text-muted-foreground">
        <span>Active:</span>
        <span className="flex items-center gap-1 text-foreground"><Plug className="w-3.5 h-3.5" /> {activePlugins} Plugins</span>
        <span className="flex items-center gap-1 text-foreground"><BookOpen className="w-3.5 h-3.5" /> {activeSkills} Skills</span>
        <span className="flex items-center gap-1 text-foreground"><Server className="w-3.5 h-3.5" /> {activeMcp} MCPs</span>
        <span className="flex items-center gap-1 text-foreground"><ScrollText className="w-3.5 h-3.5" /> {activeRules} Rules</span>
      </div>

      <Tabs defaultValue="plugins" className="w-full">
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="plugins">Plugins</TabsTrigger>
          <TabsTrigger value="skills">Skills</TabsTrigger>
          <TabsTrigger value="mcp">MCP Servers</TabsTrigger>
          <TabsTrigger value="rules">Governance Rules</TabsTrigger>
        </TabsList>
        <TabsContent value="plugins" className="mt-4 outline-none">
            <Section icon={Plug} title="Plugins" count={plugins.length}>
              <PluginManager plugins={plugins} onTogglePlugin={onTogglePlugin} />
            </Section>
          </TabsContent>
          <TabsContent value="skills" className="mt-4 outline-none">
            <Section icon={BookOpen} title="Skills" count={skills.length}>
              {skills.map((skill) => (
                <SkillRowView key={skill.id} row={skill} onToggle={onToggleSkill} onCheck={onCheckHealth} />
              ))}
            </Section>
          </TabsContent>
        <TabsContent value="mcp" className="mt-4 outline-none">
          <Section icon={Server} title="MCP servers" count={mcpServers.length}>
            {mcpServers.map((server) => (
              <McpRowView key={server.id} row={server} onToggle={onToggleMcpServer} onCheck={onCheckHealth} />
            ))}
          </Section>
        </TabsContent>
        
        <TabsContent value="rules" className="mt-4 outline-none">
          <Section icon={ScrollText} title="Rules packs" count={rulesPacks.length}>
            {rulesPacks.map((r) => (
              <RulesPackRowView key={r.id} row={r} onToggle={onToggleRulesPack} onCheck={onCheckHealth} />
            ))}
          </Section>
        </TabsContent>
      </Tabs>
    </div>
  );
}


function Section({
  icon: Icon,
  title,
  count,
  children,
}: {
  icon: typeof Server;
  title: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section aria-label={title} className="rounded-md border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Icon className="h-3.5 w-3.5 text-primary" />
        <span className="font-mono text-[11px] font-semibold tracking-wide text-foreground">{title}</span>
        <span className="font-mono text-[10px] text-muted-foreground">{count}</span>
      </div>
      {count === 0 ? (
        <p className="px-3 py-3 font-mono text-[11px] text-muted-foreground">none configured</p>
      ) : (
        <ul className="divide-y divide-border/60">{children}</ul>
      )}
    </section>
  );
}

export function HealthDot({ health }: { health: IntegrationHealth }) {
  const color =
    health === "ok"
      ? "text-emerald-400"
      : health === "error"
        ? "text-red-400"
        : health === "checking"
          ? "animate-pulse text-amber-400"
          : "text-muted-foreground";
  return (
    <span className={cn("font-mono text-[10px]", color)} title={`health: ${health}`}>
      ● {health}
    </span>
  );
}

function LastError({ lastError }: { lastError?: string | null }) {
  if (!lastError) return null;
  return (
    <p className="mt-1 rounded border border-red-500/30 bg-red-500/10 px-2 py-1 font-mono text-[10px] leading-relaxed text-red-300">
      {lastError}
    </p>
  );
}

export function RowShell({
  name,
  sub,
  enabled,
  onToggle,
  toggleDisabled,
  toggleTitle,
  health,
  lastError,
  kind,
  id,
  onCheck,
  children,
}: {
  name: string;
  sub: string;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  toggleDisabled?: boolean;
  toggleTitle?: string;
  health: IntegrationHealth;
  lastError?: string | null;
  kind: IntegrationKind;
  id: string;
  onCheck?: (kind: IntegrationKind, id: string) => void;
  children?: React.ReactNode;
}) {
  return (
    <li className="px-3 py-2.5" data-integration-id={id}>
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-mono text-[12px] text-foreground">{name}</span>
            <span className="truncate font-mono text-[10px] text-muted-foreground">{sub}</span>
          </div>
        </div>
        <HealthDot health={health} />
        {onCheck && (
          <button
            onClick={() => onCheck(kind, id)}
            className="rounded border border-border px-1.5 py-0.5 font-mono text-[9.5px] text-muted-foreground hover:text-foreground"
          >
            re-check
          </button>
        )}
        <span title={toggleTitle}>
          <Switch
            checked={enabled}
            disabled={toggleDisabled}
            onCheckedChange={onToggle}
            aria-label={`enable ${name}`}
          />
        </span>
      </div>
      {children}
      <LastError lastError={lastError} />
    </li>
  );
}

function RulesPackRowView({
  row,
  onToggle,
  onCheck,
}: {
  row: RulesPackRow;
  onToggle: (id: string, enabled: boolean) => void;
  onCheck?: (kind: IntegrationKind, id: string) => void;
}) {
  return (
    <RowShell
      name={row.name}
      sub={row.id}
      enabled={row.enabled}
      onToggle={(v) => onToggle(row.id, v)}
      health={row.health}
      lastError={row.lastError}
      kind="rules"
      id={row.id}
      onCheck={onCheck}
    >
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <span className="rounded bg-secondary px-1 py-px font-mono text-[9.5px] text-muted-foreground">
          {row.source}
        </span>
        {row.priority !== undefined && (
          <span className="rounded bg-secondary px-1 py-px font-mono text-[9.5px] text-muted-foreground">
            priority {row.priority}
          </span>
        )}
        <span
          className="flex items-center gap-1 rounded bg-secondary px-1 py-px font-mono text-[9.5px] text-muted-foreground"
          title={`context digest ${row.digest}`}
        >
          <Hash className="h-2.5 w-2.5" />
          {row.digest.slice(0, 12)}
        </span>
      </div>
    </RowShell>
  );
}

function SkillRowView({
  row,
  onToggle,
  onCheck,
}: {
  row: SkillRow;
  onToggle: (id: string, enabled: boolean) => void;
  onCheck?: (kind: IntegrationKind, id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [viewed, setViewed] = useState(false);

  const handleToggleExpand = () => {
    setExpanded((prev) => !prev);
    setViewed(true);
  };

  const isBlocked = !row.hashValid;
  const toggleDisabled = isBlocked || (!viewed && !row.enabled);
  const toggleTitle = isBlocked
    ? "Blocked: skill content hash does not match"
    : !viewed && !row.enabled
    ? "View instructions before enabling"
    : undefined;

  return (
    <RowShell
      name={row.name}
      sub={row.id}
      enabled={row.enabled}
      onToggle={(v) => onToggle(row.id, v)}
      toggleDisabled={toggleDisabled}
      toggleTitle={toggleTitle}
      health={row.health}
      lastError={row.lastError}
      kind="skill"
      id={row.id}
      onCheck={onCheck}
    >
      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
        <button
          onClick={handleToggleExpand}
          className="rounded border border-border px-1.5 py-0.5 font-mono text-[9.5px] text-muted-foreground hover:text-foreground"
          aria-label="view instructions"
        >
          {expanded ? "hide instructions" : "view instructions"}
        </button>
        {row.allowedTools.map((tool) => (
          <span key={tool} className="rounded bg-secondary px-1 py-px font-mono text-[9.5px] text-muted-foreground">
            {tool}
          </span>
        ))}
      </div>
      {expanded && (
        <div className="mt-2 rounded border border-border/60 bg-secondary/20 p-2 font-mono text-[11px] text-foreground">
          {isBlocked ? (
            <p className="font-semibold text-rose-400">hash mismatch</p>
          ) : (
            <pre className="whitespace-pre-wrap text-muted-foreground">{row.instructions}</pre>
          )}
        </div>
      )}
    </RowShell>
  );
}

function McpRowView({
  row,
  onToggle,
  onCheck,
}: {
  row: McpServerRow;
  onToggle: (id: string, enabled: boolean) => void;
  onCheck?: (kind: IntegrationKind, id: string) => void;
}) {
  return (
    <RowShell
      name={row.name}
      sub={`${row.command}${row.args?.length ? ` ${row.args.join(" ")}` : ""}`}
      enabled={row.enabled}
      onToggle={(v) => onToggle(row.id, v)}
      health={row.health}
      lastError={row.lastError}
      kind="mcp"
      id={row.id}
      onCheck={onCheck}
    >
      <div className="mt-1.5 flex flex-wrap gap-1">
        {row.tools.map((tool) => (
          <span key={tool} className="rounded bg-secondary px-1 py-px font-mono text-[9.5px] text-muted-foreground">
            {tool}
          </span>
        ))}
        {row.secretRefs?.map((ref) => (
          <span key={ref} className="rounded bg-primary/10 px-1 py-px font-mono text-[9.5px] text-primary">
            {ref}
          </span>
        ))}
      </div>
    </RowShell>
  );
}
