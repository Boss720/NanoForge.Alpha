import { useState, useEffect } from "react";
import {
  Activity,
  Calendar,
  CheckCircle2,
  Clock,
  Cpu,
  FileText,
  Plus,
  Power,
  Send,
  Terminal,
  Trash2,
  XCircle,
} from "lucide-react";
import type { TaskSummary, TaskStatus, ScheduleResult, ScheduleParams } from "@protocol/tasks";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

export interface DaemonTaskManagerProps {
  daemonTasks: TaskSummary[];
  schedules: ScheduleResult[];
  onSendInput: (taskId: string, input: string) => Promise<unknown>;
  onKillTask: (taskId: string) => Promise<unknown>;
  onCreateSchedule?: (params: ScheduleParams) => Promise<unknown>;
  onCancelSchedule: (scheduleId: string) => Promise<unknown>;
  className?: string;
}

export function getTaskStatusBadge(status: TaskStatus) {
  switch (status) {
    case "running":
      return (
        <Badge variant="outline" className="bg-emerald-500/10 text-emerald-400 border-emerald-500/30 text-[10px] flex items-center gap-1 font-mono">
          <Activity className="h-3 w-3 animate-pulse text-emerald-400" />
          Running
        </Badge>
      );
    case "completed":
      return (
        <Badge variant="outline" className="bg-teal-500/10 text-teal-400 border-teal-500/30 text-[10px] flex items-center gap-1 font-mono">
          <CheckCircle2 className="h-3 w-3 text-teal-400" />
          Completed
        </Badge>
      );
    case "failed":
      return (
        <Badge variant="outline" className="bg-red-500/10 text-red-400 border-red-500/30 text-[10px] flex items-center gap-1 font-mono">
          <XCircle className="h-3 w-3 text-red-400" />
          Failed
        </Badge>
      );
    case "killed":
    case "cancelled":
      return (
        <Badge variant="secondary" className="text-[10px] font-mono">
          {status}
        </Badge>
      );
    default:
      return (
        <Badge variant="secondary" className="text-[10px] font-mono">
          {status}
        </Badge>
      );
  }
}

export function formatUptime(startedAt: string, completedAt?: string): string {
  try {
    const start = new Date(startedAt).getTime();
    const end = completedAt ? new Date(completedAt).getTime() : Date.now();
    const sec = Math.max(0, Math.floor((end - start) / 1000));
    if (sec < 60) return `${sec}s`;
    const min = Math.floor(sec / 60);
    const remSec = sec % 60;
    if (min < 60) return `${min}m ${remSec}s`;
    const hrs = Math.floor(min / 60);
    const remMin = min % 60;
    return `${hrs}h ${remMin}m`;
  } catch {
    return "0s";
  }
}

export function DaemonTaskManager({
  daemonTasks,
  schedules,
  onSendInput,
  onKillTask,
  onCreateSchedule,
  onCancelSchedule,
  className = "",
}: DaemonTaskManagerProps) {
  const [stdinInputs, setStdinInputs] = useState<Record<string, string>>({});
  const [activeLogTask, setActiveLogTask] = useState<TaskSummary | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  // New schedule form state
  const [schedPrompt, setSchedPrompt] = useState("");
  const [schedType, setSchedType] = useState<"one_shot" | "cron">("one_shot");
  const [schedDuration, setSchedDuration] = useState("300");
  const [schedCron, setSchedCron] = useState("*/5 * * * *");
  const [schedIsDaemon, setSchedIsDaemon] = useState(false);
  const [isSubmittingSched, setIsSubmittingSched] = useState(false);

  // Keep activeLogTask updated when daemonTasks updates
  useEffect(() => {
    if (activeLogTask) {
      const updated = daemonTasks.find((t) => t.taskId === activeLogTask.taskId);
      if (updated) setActiveLogTask(updated);
    }
  }, [daemonTasks, activeLogTask]);

  const handleSendStdin = async (taskId: string) => {
    const input = stdinInputs[taskId];
    if (!input || !input.trim()) return;

    try {
      await onSendInput(taskId, input);
      setStdinInputs((prev) => ({ ...prev, [taskId]: "" }));
    } catch {
      // ignore
    }
  };

  const handleCreateScheduleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!onCreateSchedule || !schedPrompt.trim()) return;

    setIsSubmittingSched(true);
    try {
      if (schedType === "one_shot") {
        await onCreateSchedule({
          prompt: schedPrompt.trim(),
          durationSeconds: parseInt(schedDuration, 10) || 300,
          timerCondition: "never",
          isDaemon: schedIsDaemon,
        });
      } else {
        await onCreateSchedule({
          prompt: schedPrompt.trim(),
          cronExpression: schedCron.trim(),
          timerCondition: "never",
          isDaemon: schedIsDaemon,
        });
      }
      setIsCreateOpen(false);
      setSchedPrompt("");
    } catch {
      // ignore
    } finally {
      setIsSubmittingSched(false);
    }
  };

  return (
    <div className={`flex flex-col h-full overflow-y-auto p-3 space-y-6 scrollbar-thin ${className}`} data-testid="daemon-task-manager">
      {/* Background Daemon Tasks Section */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Cpu className="h-4 w-4 text-primary" />
            <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-foreground">
              Background Tasks &amp; Daemons ({daemonTasks.length})
            </h3>
          </div>
        </div>

        {daemonTasks.length === 0 ? (
          <div className="rounded-lg border border-border/60 bg-card/40 p-6 text-center text-muted-foreground font-mono text-xs">
            <Terminal className="h-6 w-6 mx-auto mb-2 opacity-40" />
            <p>No background daemon tasks active</p>
            <p className="text-[11px] text-muted-foreground/70 mt-1">
              Processes launched with <code>isDaemon: true</code> or <code>manage_task</code> run concurrently here.
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {daemonTasks.map((task) => {
              const stdinVal = stdinInputs[task.taskId] ?? "";
              const isRunning = task.status === "running";

              return (
                <div
                  key={task.taskId}
                  className="rounded-lg border border-border bg-card p-3 shadow-xs space-y-2.5"
                  data-testid={`daemon-task-card-${task.taskId}`}
                >
                  {/* Row 1: Header */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="p-1 rounded bg-secondary text-primary font-mono text-xs font-bold">
                        PID {task.pid}
                      </div>
                      <span className="font-mono text-xs font-semibold text-foreground truncate" title={task.command}>
                        {task.command}
                      </span>
                      {task.args.length > 0 && (
                        <span className="font-mono text-[11px] text-muted-foreground truncate max-w-[200px]" title={task.args.join(" ")}>
                          {task.args.join(" ")}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {getTaskStatusBadge(task.status)}

                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 text-[11px] font-mono text-muted-foreground hover:text-foreground"
                        onClick={() => setActiveLogTask(task)}
                      >
                        <FileText className="h-3 w-3 mr-1" />
                        Logs
                      </Button>

                      {isRunning && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-[11px] font-mono text-red-400 hover:bg-red-500/10 hover:text-red-300"
                          onClick={() => onKillTask(task.taskId)}
                        >
                          <Power className="h-3 w-3 mr-1" />
                          Kill
                        </Button>
                      )}
                    </div>
                  </div>

                  {/* Row 2: Details */}
                  <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono text-muted-foreground">
                    <span className="text-muted-foreground/70 truncate max-w-[250px]" title={task.cwd}>
                      cwd: {task.cwd}
                    </span>

                    <span className="flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      <span>{formatUptime(task.startedAt, task.completedAt)}</span>
                    </span>

                    {task.isDaemon && (
                      <Badge variant="outline" className="font-mono text-[9px] px-1 py-0 text-cyan-400 border-cyan-500/30 bg-cyan-500/10">
                        Daemon
                      </Badge>
                    )}

                    {task.exitCode !== undefined && task.exitCode !== null && (
                      <span>exit: {task.exitCode}</span>
                    )}
                  </div>

                  {/* Row 3: Interactive STDIN bar for running processes */}
                  {isRunning && (
                    <div className="flex items-center gap-2 pt-1">
                      <Input
                        placeholder="Send STDIN input to daemon..."
                        value={stdinVal}
                        onChange={(e) => setStdinInputs((prev) => ({ ...prev, [task.taskId]: e.target.value }))}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            handleSendStdin(task.taskId);
                          }
                        }}
                        className="h-7 font-mono text-xs bg-background"
                      />
                      <Button
                        size="sm"
                        className="h-7 px-2.5 font-mono text-xs"
                        onClick={() => handleSendStdin(task.taskId)}
                        disabled={!stdinVal.trim()}
                      >
                        <Send className="h-3 w-3 mr-1" />
                        Send
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Scheduler & Timers Section */}
      <div className="space-y-3 pt-3 border-t border-border">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-primary" />
            <h3 className="font-mono text-xs font-bold uppercase tracking-wider text-foreground">
              Scheduler &amp; Timers ({schedules.length})
            </h3>
          </div>

          {onCreateSchedule && (
            <Button
              variant="outline"
              size="sm"
              className="h-6 px-2 font-mono text-[11px]"
              onClick={() => setIsCreateOpen(true)}
            >
              <Plus className="h-3 w-3 mr-1" />
              New Schedule
            </Button>
          )}
        </div>

        {schedules.length === 0 ? (
          <div className="rounded-lg border border-border/60 bg-card/40 p-6 text-center text-muted-foreground font-mono text-xs">
            <Clock className="h-6 w-6 mx-auto mb-2 opacity-40" />
            <p>No active timers or cron schedules</p>
            <p className="text-[11px] text-muted-foreground/70 mt-1">
              One-shot timers (DurationSeconds) and recurring jobs (CronExpression) appear here.
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {schedules.map((sched) => {
              const isOneShot = sched.type === "one_shot";

              return (
                <div
                  key={sched.scheduleId}
                  className="rounded-lg border border-border bg-card p-3 shadow-xs space-y-2"
                  data-testid={`schedule-card-${sched.scheduleId}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Badge variant="outline" className={`font-mono text-[10px] ${isOneShot ? "text-blue-400 border-blue-500/30" : "text-purple-400 border-purple-500/30"}`}>
                        {isOneShot ? "One-Shot Timer" : "Recurring Cron"}
                      </Badge>
                      <span className="font-mono text-xs font-semibold text-foreground truncate" title={sched.prompt}>
                        {sched.prompt}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant="outline" className={`font-mono text-[10px] ${sched.status === "active" ? "text-emerald-400 border-emerald-500/30" : "text-muted-foreground"}`}>
                        {sched.status}
                      </Badge>

                      {sched.status === "active" && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 px-2 text-[11px] font-mono text-red-400 hover:bg-red-500/10 hover:text-red-300"
                          onClick={() => onCancelSchedule(sched.scheduleId)}
                        >
                          <Trash2 className="h-3 w-3 mr-1" />
                          Cancel
                        </Button>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-3 text-[11px] font-mono text-muted-foreground">
                    {sched.targetAt && (
                      <span>Target: {new Date(sched.targetAt).toLocaleTimeString()}</span>
                    )}
                    {sched.nextRunAt && (
                      <span>Next Run: {new Date(sched.nextRunAt).toLocaleTimeString()}</span>
                    )}
                    {sched.isDaemon && (
                      <Badge variant="secondary" className="font-mono text-[9px] px-1 py-0">
                        Daemon Mode
                      </Badge>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Task Log Modal */}
      <Dialog open={!!activeLogTask} onOpenChange={(open) => !open && setActiveLogTask(null)}>
        <DialogContent className="max-w-2xl border-border bg-card">
          <DialogHeader>
            <DialogTitle className="font-mono text-xs">
              Logs: {activeLogTask?.command} (PID {activeLogTask?.pid})
            </DialogTitle>
            <DialogDescription className="font-mono text-[11px]">
              Task ID: {activeLogTask?.taskId}
            </DialogDescription>
          </DialogHeader>

          <div className="rounded border border-border bg-zinc-950 p-3 text-[11px] font-mono text-zinc-100 max-h-96 overflow-y-auto scrollbar-thin whitespace-pre-wrap leading-relaxed">
            {activeLogTask?.recentLogs || "* No log output available *"}
          </div>
        </DialogContent>
      </Dialog>

      {/* Create Schedule Modal */}
      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent className="max-w-md border-border bg-card">
          <DialogHeader>
            <DialogTitle className="font-mono text-xs">Create Schedule or Timer</DialogTitle>
            <DialogDescription className="font-mono text-[11px]">
              Set up a one-shot notification timer or recurring cron schedule.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreateScheduleSubmit} className="space-y-3 font-mono text-xs">
            <div>
              <label className="block text-muted-foreground mb-1">Prompt / Message</label>
              <Input
                placeholder="e.g. Check deployment status"
                value={schedPrompt}
                onChange={(e) => setSchedPrompt(e.target.value)}
                required
                className="h-8 font-mono text-xs bg-background"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-muted-foreground mb-1">Schedule Type</label>
                <select
                  value={schedType}
                  onChange={(e) => setSchedType(e.target.value as "one_shot" | "cron")}
                  className="w-full h-8 rounded border border-input bg-background px-2 font-mono text-xs"
                >
                  <option value="one_shot">One-Shot (Duration)</option>
                  <option value="cron">Recurring (Cron)</option>
                </select>
              </div>

              {schedType === "one_shot" ? (
                <div>
                  <label className="block text-muted-foreground mb-1">Duration (seconds)</label>
                  <Input
                    type="number"
                    value={schedDuration}
                    onChange={(e) => setSchedDuration(e.target.value)}
                    min={1}
                    className="h-8 font-mono text-xs bg-background"
                  />
                </div>
              ) : (
                <div>
                  <label className="block text-muted-foreground mb-1">Cron Expression (5-field)</label>
                  <Input
                    value={schedCron}
                    onChange={(e) => setSchedCron(e.target.value)}
                    placeholder="*/5 * * * *"
                    className="h-8 font-mono text-xs bg-background"
                  />
                </div>
              )}
            </div>

            <div className="flex items-center gap-2 pt-1">
              <label className="flex items-center gap-2 cursor-pointer text-muted-foreground">
                <input
                  type="checkbox"
                  checked={schedIsDaemon}
                  onChange={(e) => setSchedIsDaemon(e.target.checked)}
                  className="rounded border-border bg-background text-primary focus:ring-1 focus:ring-primary h-3.5 w-3.5"
                />
                <span>Daemon Mode (survives subagent lifetime)</span>
              </label>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setIsCreateOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={isSubmittingSched || !schedPrompt.trim()}>
                {isSubmittingSched ? "Creating..." : "Create Schedule"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
