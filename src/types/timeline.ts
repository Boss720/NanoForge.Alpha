export type TaskStepKind = 
  | 'read_files'      // 📖 Agent read files
  | 'analyze'         // 🔍 Agent analyzed code
  | 'plan'            // 📋 Agent created a plan
  | 'edit_files'      // ✏️ Agent edited files
  | 'run_command'     // ▶️ Agent ran a command
  | 'run_tests'       // 🧪 Agent ran tests
  | 'verify'          // ✅ Agent verified changes
  | 'search'          // 🔍 Agent searched codebase
  | 'approval'        // 🔒 Waiting for approval
  | 'error'           // ❌ Step failed
  | 'complete';       // 🎉 Task complete

export type TaskStepStatus = 'pending' | 'running' | 'success' | 'failed' | 'blocked' | 'skipped';

export interface TaskStep {
  id: string;
  kind: TaskStepKind;
  title: string;
  description?: string;
  status: TaskStepStatus;
  startedAt?: number;   // epoch ms
  completedAt?: number; // epoch ms
  durationMs?: number;
  /** Files involved in this step */
  files?: string[];
  /** Command that was run */
  command?: string;
  /** Output excerpt */
  output?: string;
  /** Patch summary */
  patchSummary?: string;
  /** Link to audit log entry */
  auditEntryId?: string;
}

export interface TaskTimeline {
  id: string;
  goal: string;
  status: 'active' | 'completed' | 'failed' | 'paused';
  steps: TaskStep[];
  startedAt: number;
  completedAt?: number;
}
