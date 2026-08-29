import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { DaemonManager, type DaemonAuthorizationCallback } from "./manager.js";
import { executeManageTaskTool, executeScheduleTool } from "./tools.js";
import type { SpawnTaskOptions } from "./types.js";

describe("DaemonManager & Tool Execution", () => {
  let manager: DaemonManager;

  beforeEach(() => {
    manager = new DaemonManager();
  });

  afterEach(async () => {
    await manager.dispose();
  });

  it("manages tasks via manageTask and tool handlers", async () => {
    const isWindows = process.platform === "win32";
    const command = isWindows ? "cmd" : "node";
    const args = isWindows ? ["/c", "echo hello"] : ["-e", "console.log('hello')"];

    const task = await manager.supervisor.spawnTask({
      command,
      args,
      cwd: process.cwd(),
    });

    // 1. List
    const listRes = await executeManageTaskTool(manager, { action: "list" });
    expect(listRes.success).toBe(true);
    expect(listRes.tasks?.length).toBeGreaterThanOrEqual(1);

    // 2. Status
    const statusRes = await executeManageTaskTool(manager, {
      action: "status",
      taskId: task.taskId,
    });
    expect(statusRes.success).toBe(true);
    expect(statusRes.task?.taskId).toBe(task.taskId);

    // 3. Kill
    const killRes = await executeManageTaskTool(manager, {
      action: "kill",
      taskId: task.taskId,
    });
    expect(killRes.success).toBe(true);
  });

  it("handles schedule tool executions", async () => {
    const result = await executeScheduleTool(manager, {
      prompt: "Notify user of progress",
      durationSeconds: 120,
      timerCondition: "never",
    });

    expect(result.scheduleId).toBeDefined();
    expect(result.type).toBe("one_shot");
    expect(result.status).toBe("active");
  });

  it("denies process and schedule mutations before side effects when enforcement is enabled", async () => {
    const denied = new DaemonManager(undefined, undefined, undefined, { enforceCapabilityAuthorization: true });
    const spawnOptions: SpawnTaskOptions = { command: process.execPath, args: ["-e", "setTimeout(() => {}, 60000)"], cwd: process.cwd() };

    await expect(denied.spawnTask(spawnOptions)).rejects.toThrow("Capability authorization denied: task.spawn");
    expect(denied.supervisor.listTasks()).toHaveLength(0);
    await expect(denied.scheduleTask({ prompt: "should not exist", durationSeconds: 60, timerCondition: "never", isDaemon: false })).rejects.toThrow(
      "Capability authorization denied: schedule.create",
    );
    expect(denied.scheduler.listSchedules()).toHaveLength(0);
    await expect(denied.cancelSchedule("00000000-0000-4000-8000-000000000000")).resolves.toBe(false);
    await denied.dispose();
  });

  it("passes digested metadata to authorization and preserves granted mutations", async () => {
    const authorize = vi.fn<DaemonAuthorizationCallback>(() => true);
    const granted = new DaemonManager(undefined, undefined, undefined, {
      enforceCapabilityAuthorization: true,
      authorize,
    });
    const task = await granted.spawnTask({
      command: process.execPath,
      args: ["-e", "console.log('granted')"],
      cwd: process.cwd(),
      env: { SECRET_VALUE: "must-not-leak" },
    });
    expect(task.taskId).toBeDefined();
    const spawnContext = authorize.mock.calls[0]?.[0];
    expect(spawnContext).toBeDefined();
    expect(spawnContext.operation).toBe("task.spawn");
    expect(JSON.stringify(spawnContext)).not.toContain("must-not-leak");
    expect(JSON.stringify(spawnContext)).not.toContain("console.log('granted')");

    const schedule = await granted.scheduleTask({ prompt: "granted schedule", durationSeconds: 60, timerCondition: "never", isDaemon: false });
    expect(schedule.status).toBe("active");
    expect(authorize).toHaveBeenCalledWith(expect.objectContaining({ operation: "schedule.create" }));
    await granted.dispose();
  });
});
