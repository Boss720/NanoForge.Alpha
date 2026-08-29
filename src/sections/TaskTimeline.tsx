import { useState } from 'react';
import {
  BookOpen,
  Search,
  ClipboardList,
  Pencil,
  Play,
  TestTube,
  CheckCircle,
  Lock,
  XCircle,
  PartyPopper,
  ChevronDown,
  ChevronRight,
  FileIcon,
  Code
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Collapsible, CollapsibleContent } from '@/components/ui/collapsible';
import type { TaskTimeline as TaskTimelineType, TaskStep, TaskStepKind } from '@/types/timeline';

interface TaskTimelineProps {
  timeline: TaskTimelineType;
  onViewDiff?: (stepId: string) => void;
  onViewOutput?: (stepId: string) => void;
  className?: string;
  elapsed?: number; // pass elapsed time in seconds
}

const getStepIcon = (kind: TaskStepKind) => {
  switch (kind) {
    case 'read_files': return <BookOpen className="w-4 h-4" />;
    case 'analyze': return <Search className="w-4 h-4" />;
    case 'plan': return <ClipboardList className="w-4 h-4" />;
    case 'edit_files': return <Pencil className="w-4 h-4" />;
    case 'run_command': return <Play className="w-4 h-4" />;
    case 'run_tests': return <TestTube className="w-4 h-4" />;
    case 'verify': return <CheckCircle className="w-4 h-4" />;
    case 'search': return <Search className="w-4 h-4" />;
    case 'approval': return <Lock className="w-4 h-4" />;
    case 'error': return <XCircle className="w-4 h-4" />;
    case 'complete': return <PartyPopper className="w-4 h-4" />;
    default: return <CheckCircle className="w-4 h-4" />;
  }
};

const formatDuration = (ms?: number) => {
  if (ms === undefined) return '--';
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const remainingS = s % 60;
  return `${m}m ${remainingS}s`;
};

const formatElapsed = (seconds: number) => {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m ${s}s`;
};

const StepItem = ({
  step,
  isLast,
  onViewDiff,
  onViewOutput
}: {
  step: TaskStep;
  isLast: boolean;
  onViewDiff?: (id: string) => void;
  onViewOutput?: (id: string) => void;
}) => {
  const [isOpen, setIsOpen] = useState(step.status === 'running' || step.status === 'failed');

  const hasDetails = step.files?.length || step.command || step.output || step.patchSummary;

  return (
    <div className="relative pl-6 pb-6 last:pb-0 group">
      {/* Connector Line */}
      {!isLast && (
        <div
          className={cn(
            'absolute left-2 top-6 bottom-0 w-px -translate-x-1/2',
            step.status === 'success' || step.status === 'skipped' ? 'bg-green-500/50' :
              step.status === 'running' ? 'bg-blue-500/50' : 'bg-border'
          )}
        />
      )}

      {/* Step Dot */}
      <div
        className={cn(
          'absolute left-2 top-1.5 -translate-x-1/2 w-3 h-3 rounded-full border-2 bg-background',
          step.status === 'success' ? 'bg-green-500 border-green-500' :
          step.status === 'running' ? 'bg-blue-500 border-blue-500 animate-pulse ring-2 ring-blue-500/30' :
          step.status === 'failed' ? 'bg-red-500 border-red-500' :
          step.status === 'blocked' ? 'bg-amber-500 border-amber-500' :
          step.status === 'skipped' ? 'bg-muted border-muted-foreground' :
          'border-muted-foreground' // pending
        )}
      />

      <div className={cn('rounded-md transition-colors', isOpen ? 'bg-muted/30 p-3 -m-3' : '')}>
        <div 
          className={cn(
            "flex items-center justify-between gap-4",
            hasDetails && "cursor-pointer select-none"
          )}
          onClick={() => hasDetails && setIsOpen(!isOpen)}
        >
          <div className="flex items-center gap-2 overflow-hidden">
            <span className={cn(
              "text-muted-foreground flex-shrink-0",
              step.status === 'running' && 'text-blue-500',
              step.status === 'failed' && 'text-red-500',
              step.status === 'success' && 'text-green-500',
            )}>
              {getStepIcon(step.kind)}
            </span>
            <span className={cn(
              "font-medium truncate",
              step.status === 'pending' && "text-muted-foreground",
              step.status === 'skipped' && "line-through text-muted-foreground"
            )}>
              {step.title}
            </span>
            {hasDetails && (
              <span className="text-muted-foreground/50 transition-transform duration-200">
                {isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
              </span>
            )}
          </div>
          <div className="text-xs text-muted-foreground whitespace-nowrap tabular-nums">
            {formatDuration(step.durationMs)}
          </div>
        </div>

        {step.description && !isOpen && (
          <div className="text-sm text-muted-foreground mt-1 truncate">
            {step.description}
          </div>
        )}

        <Collapsible open={isOpen} onOpenChange={setIsOpen}>
          <CollapsibleContent className="space-y-3 pt-3 overflow-hidden transition-all data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
            {step.description && (
              <div className="text-sm text-muted-foreground">
                {step.description}
              </div>
            )}
            
            {step.files && step.files.length > 0 && (
              <div className="space-y-1">
                {step.files.map((file, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm text-muted-foreground">
                    <FileIcon className="w-3.5 h-3.5" />
                    <span className="truncate">{file}</span>
                  </div>
                ))}
              </div>
            )}

            {step.command && (
              <div className="bg-background border rounded p-2 text-xs font-mono text-muted-foreground overflow-x-auto">
                $ {step.command}
              </div>
            )}

            {step.output && (
              <div className="bg-background border rounded p-2 text-xs font-mono text-muted-foreground max-h-32 overflow-y-auto whitespace-pre-wrap">
                {step.output}
              </div>
            )}

            {step.patchSummary && (
              <div className="text-sm text-muted-foreground bg-muted/50 p-2 rounded border">
                {step.patchSummary}
              </div>
            )}

            {(onViewDiff && step.patchSummary) || (onViewOutput && step.output) ? (
              <div className="flex gap-3 pt-1">
                {onViewDiff && step.patchSummary && (
                  <button 
                    onClick={(e) => { e.stopPropagation(); onViewDiff(step.id); }}
                    className="text-xs text-blue-500 hover:underline flex items-center gap-1"
                  >
                    <Code className="w-3 h-3" /> View Diff
                  </button>
                )}
                {onViewOutput && step.output && (
                  <button 
                    onClick={(e) => { e.stopPropagation(); onViewOutput(step.id); }}
                    className="text-xs text-blue-500 hover:underline flex items-center gap-1"
                  >
                    <Code className="w-3 h-3" /> View Output
                  </button>
                )}
              </div>
            ) : null}
          </CollapsibleContent>
        </Collapsible>
      </div>
    </div>
  );
};

export function TaskTimeline({ timeline, onViewDiff, onViewOutput, className, elapsed = 0 }: TaskTimelineProps) {
  const completedSteps = timeline.steps.filter(s => s.status === 'success' || s.status === 'skipped').length;
  
  return (
    <div className={cn("flex flex-col border rounded-lg bg-card text-card-foreground shadow-sm overflow-hidden", className)}>
      {/* Header */}
      <div className="p-4 border-b bg-muted/10 space-y-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <span className="text-yellow-500 text-lg">⚡</span>
            <span>Task: "{timeline.goal}"</span>
          </div>
          <Badge 
            variant={
              timeline.status === 'active' ? 'default' :
              timeline.status === 'completed' ? 'secondary' :
              timeline.status === 'failed' ? 'destructive' :
              'outline'
            }
            className={cn(
              timeline.status === 'active' && 'bg-blue-500 hover:bg-blue-600',
              timeline.status === 'completed' && 'bg-green-500 text-white hover:bg-green-600'
            )}
          >
            {timeline.status.charAt(0).toUpperCase() + timeline.status.slice(1)}
          </Badge>
        </div>
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5">
            <div className={cn(
              "w-2 h-2 rounded-full",
              timeline.status === 'active' ? "bg-blue-500 animate-pulse" : 
              timeline.status === 'completed' ? "bg-green-500" : "bg-muted-foreground"
            )} />
            {timeline.status === 'active' ? `${formatElapsed(elapsed)} elapsed` : 
             timeline.status === 'completed' && timeline.completedAt ? `Completed in ${formatElapsed(Math.floor((timeline.completedAt - timeline.startedAt) / 1000))}` : 
             'Paused'}
          </div>
          <div>•</div>
          <div>{completedSteps} of {timeline.steps.length} steps completed</div>
        </div>
      </div>

      {/* Timeline Steps */}
      <ScrollArea className="flex-1 p-6">
        <div className="max-w-2xl mx-auto">
          {timeline.steps.map((step, idx) => (
            <StepItem 
              key={step.id} 
              step={step} 
              isLast={idx === timeline.steps.length - 1} 
              onViewDiff={onViewDiff}
              onViewOutput={onViewOutput}
            />
          ))}
          {timeline.steps.length === 0 && (
            <div className="text-sm text-muted-foreground text-center py-8">
              Initializing task...
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
