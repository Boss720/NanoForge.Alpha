// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import "@testing-library/jest-dom/vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";

afterEach(cleanup);
import { DaemonTaskManager } from "../subagents/DaemonTaskManager";
import type { TaskSummary, ScheduleResult } from "@protocol/tasks";

const mockTasks: TaskSummary[] = [
  {
    taskId: "task-001",
    pid: 12345,
    command: "vite",
    args: ["--port", "5173"],
    cwd: "/nano-forge",
    isDaemon: true,
    status: "running",
    startedAt: new Date(Date.now() - 300000).toISOString(),
    recentLogs: "VITE v5.0.0 ready in 250 ms\nLocal: http://localhost:5173/\n",
  },
  {
    taskId: "task-002",
    pid: 12346,
    command: "pytest",
    args: ["-v"],
    cwd: "/nano-forge",
    isDaemon: false,
    status: "completed",
    startedAt: new Date(Date.now() - 60000).toISOString(),
    completedAt: new Date(Date.now() - 10000).toISOString(),
    exitCode: 0,
    recentLogs: "25 passed in 0.45s\n",
  },
];

const mockSchedules: ScheduleResult[] = [
  {
    scheduleId: "sched-001",
    type: "one_shot",
    prompt: "Poll deployment endpoint",
    status: "active",
    targetAt: new Date(Date.now() + 600000).toISOString(),
    isDaemon: false,
  },
  {
    scheduleId: "sched-002",
    type: "cron",
    prompt: "Every 5 min heartbeat",
    status: "active",
    nextRunAt: new Date(Date.now() + 300000).toISOString(),
    isDaemon: true,
  },
];

describe("DaemonTaskManager Component", () => {
  it("renders background daemon tasks and scheduler monitors", () => {
    const onSendInput = vi.fn().mockResolvedValue({});
    const onKillTask = vi.fn().mockResolvedValue({});
    const onCancelSchedule = vi.fn().mockResolvedValue({});

    render(
      <DaemonTaskManager
        daemonTasks={mockTasks}
        schedules={mockSchedules}
        onSendInput={onSendInput}
        onKillTask={onKillTask}
        onCancelSchedule={onCancelSchedule}
      />
    );

    expect(screen.getByText(/PID 12345/)).toBeDefined();
    expect(screen.getByText("vite")).toBeDefined();
    expect(screen.getByText(/PID 12346/)).toBeDefined();
    expect(screen.getByText("pytest")).toBeDefined();
    expect(screen.getByText("Poll deployment endpoint")).toBeDefined();
    expect(screen.getByText("Every 5 min heartbeat")).toBeDefined();
  });

  it("sends STDIN input to running daemon task", () => {
    const onSendInput = vi.fn().mockResolvedValue({});
    const onKillTask = vi.fn().mockResolvedValue({});
    const onCancelSchedule = vi.fn().mockResolvedValue({});

    render(
      <DaemonTaskManager
        daemonTasks={mockTasks}
        schedules={mockSchedules}
        onSendInput={onSendInput}
        onKillTask={onKillTask}
        onCancelSchedule={onCancelSchedule}
      />
    );

    const stdinInput = screen.getByPlaceholderText(/Send STDIN input to daemon/i);
    fireEvent.change(stdinInput, { target: { value: "r" } });

    const sendBtn = screen.getByRole("button", { name: /Send/i });
    fireEvent.click(sendBtn);

    expect(onSendInput).toHaveBeenCalledWith("task-001", "r");
  });

  it("kills running daemon task when Kill button is clicked", () => {
    const onSendInput = vi.fn().mockResolvedValue({});
    const onKillTask = vi.fn().mockResolvedValue({});
    const onCancelSchedule = vi.fn().mockResolvedValue({});

    render(
      <DaemonTaskManager
        daemonTasks={mockTasks}
        schedules={mockSchedules}
        onSendInput={onSendInput}
        onKillTask={onKillTask}
        onCancelSchedule={onCancelSchedule}
      />
    );

    const killBtn = screen.getByRole("button", { name: /Kill/i });
    fireEvent.click(killBtn);

    expect(onKillTask).toHaveBeenCalledWith("task-001");
  });

  it("cancels schedule when Cancel button is clicked", () => {
    const onSendInput = vi.fn().mockResolvedValue({});
    const onKillTask = vi.fn().mockResolvedValue({});
    const onCancelSchedule = vi.fn().mockResolvedValue({});

    render(
      <DaemonTaskManager
        daemonTasks={mockTasks}
        schedules={mockSchedules}
        onSendInput={onSendInput}
        onKillTask={onKillTask}
        onCancelSchedule={onCancelSchedule}
      />
    );

    const cancelBtns = screen.getAllByRole("button", { name: /Cancel/i });
    fireEvent.click(cancelBtns[0]);

    expect(onCancelSchedule).toHaveBeenCalledWith("sched-001");
  });
});
