import { useState, useEffect, useCallback } from 'react';
import type { TaskTimeline, TaskStep } from '@/types/timeline';

export function useTaskTimeline() {
  const [timeline, setTimeline] = useState<TaskTimeline | null>(null);
  const [elapsed, setElapsed] = useState(0);

  // Auto-update elapsed time every second when active
  useEffect(() => {
    let interval: ReturnType<typeof setInterval>;
    if (timeline && timeline.status === 'active') {
      interval = setInterval(() => {
        setElapsed(Math.floor((Date.now() - timeline.startedAt) / 1000));
      }, 1000);
    } else if (timeline && timeline.completedAt) {
      setElapsed(Math.floor((timeline.completedAt - timeline.startedAt) / 1000));
    }
    return () => clearInterval(interval);
  }, [timeline]);

  const startTask = useCallback((goal: string) => {
    setTimeline({
      id: crypto.randomUUID(),
      goal,
      status: 'active',
      steps: [],
      startedAt: Date.now(),
    });
    setElapsed(0);
  }, []);

  const addStep = useCallback((step: TaskStep) => {
    setTimeline((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        steps: [...prev.steps, step],
      };
    });
  }, []);

  const updateStep = useCallback((stepId: string, updates: Partial<TaskStep>) => {
    setTimeline((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        steps: prev.steps.map((step) => (step.id === stepId ? { ...step, ...updates } : step)),
      };
    });
  }, []);

  const completeTask = useCallback(() => {
    setTimeline((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        status: 'completed',
        completedAt: Date.now(),
      };
    });
  }, []);

  return { timeline, elapsed, startTask, addStep, updateStep, completeTask, setTimeline };
}

/* Kept as a compatibility shim for callers that have not migrated yet. */
export function useDemoTaskTimeline() {
  const { timeline, elapsed } = useTaskTimeline();
  useEffect(() => undefined, []);
  return { timeline, elapsed };
}
/*
    const now = Date.now();
    setTimeline({
      id: 'demo-123',
      goal: 'Fix the login validation bug',
      status: 'active',
      startedAt: now - 154000, // 2m 34s ago
      steps: [
        {
          id: 'step-1',
          kind: 'read_files',
          title: 'Read files',
          status: 'success',
          durationMs: 12000,
          files: ['src/auth/login.ts', 'src/auth/validator.ts']
        },
        {
          id: 'step-2',
          kind: 'analyze',
          title: 'Analyzed code',
          description: 'Found validation gap in line 42',
          status: 'success',
          durationMs: 8000
        },
        {
          id: 'step-3',
          kind: 'edit_files',
          title: 'Edited files',
          status: 'success',
          durationMs: 15000,
          patchSummary: '+12 -3 lines in validator.ts',
          files: ['src/auth/validator.ts']
        },
        {
          id: 'step-4',
          kind: 'run_tests',
          title: 'Running tests...',
          status: 'running',
          command: 'npm run test',
          output: 'Running vitest...\n\n ✓ src/auth/login.test.ts (4)\n ⠋ src/auth/validator.test.ts (testing edge cases)'
        },
        {
          id: 'step-5',
          kind: 'verify',
          title: 'Verify changes',
          status: 'pending'
        },
        {
          id: 'step-6',
          kind: 'complete',
          title: 'Complete',
          status: 'pending'
        }
      ]
    });
  }, [setTimeline]);

  return { timeline, elapsed };
} */
