import { useState } from "react";
import { Check, Edit3, X, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ArtifactMetadata, ArtifactFeedbackResponse } from "@/types/artifacts";

interface ArtifactFeedbackBarProps {
  artifact: ArtifactMetadata;
  onSendFeedback: (response: ArtifactFeedbackResponse) => void;
  className?: string;
}

export function ArtifactFeedbackBar({
  artifact,
  onSendFeedback,
  className = "",
}: ArtifactFeedbackBarProps) {
  const [comment, setComment] = useState("");
  const [isModifying, setIsModifying] = useState(false);
  const [status, setStatus] = useState<"idle" | "accepted" | "modified" | "rejected">("idle");

  if (!artifact.requestFeedback && status === "idle") {
    return null;
  }

  const handleAccept = () => {
    setStatus("accepted");
    onSendFeedback({
      artifactId: artifact.id,
      decision: "accepted",
      comment: comment.trim() || undefined,
      timestamp: new Date().toISOString(),
    });
  };

  const handleReject = () => {
    setStatus("rejected");
    onSendFeedback({
      artifactId: artifact.id,
      decision: "rejected",
      comment: comment.trim() || undefined,
      timestamp: new Date().toISOString(),
    });
  };

  const handleSendModification = () => {
    if (!comment.trim()) return;
    setStatus("modified");
    onSendFeedback({
      artifactId: artifact.id,
      decision: "modified",
      comment: comment.trim(),
      timestamp: new Date().toISOString(),
    });
    setIsModifying(false);
  };

  return (
    <div className={`border-t border-border bg-card/90 p-3 shadow-md backdrop-blur-sm ${className}`}>
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-primary">
              Feedback Requested
            </span>
            <span className="text-[12px] text-foreground">
              {artifact.feedbackPrompt || `Review and approve artifact "${artifact.name}"`}
            </span>
          </div>

          {status !== "idle" && (
            <span className="font-mono text-[11px] text-muted-foreground">
              Status: {status.toUpperCase()}
            </span>
          )}
        </div>

        {isModifying ? (
          <div className="space-y-2 pt-1">
            <textarea
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              placeholder="Describe the modifications required for this artifact..."
              rows={2}
              className="w-full resize-none rounded-md border border-border bg-background p-2 font-mono text-[12px] text-foreground outline-none focus:border-primary"
            />
            <div className="flex justify-end gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-[11px]"
                onClick={() => setIsModifying(false)}
              >
                Cancel
              </Button>
              <Button
                variant="default"
                size="sm"
                className="h-7 gap-1 text-[11px]"
                disabled={!comment.trim()}
                onClick={handleSendModification}
              >
                <Send className="h-3 w-3" />
                <span>Submit Modifications</span>
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-end gap-2 pt-1">
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1 text-[11px] text-rose-400 hover:bg-rose-500/10 hover:text-rose-300"
              onClick={handleReject}
              disabled={status !== "idle"}
            >
              <X className="h-3.5 w-3.5" />
              <span>Reject</span>
            </Button>

            <Button
              variant="secondary"
              size="sm"
              className="h-7 gap-1 text-[11px]"
              onClick={() => setIsModifying(true)}
              disabled={status !== "idle"}
            >
              <Edit3 className="h-3.5 w-3.5" />
              <span>Request Modifications</span>
            </Button>

            <Button
              variant="default"
              size="sm"
              className="h-7 gap-1 text-[11px]"
              onClick={handleAccept}
              disabled={status !== "idle"}
            >
              <Check className="h-3.5 w-3.5" />
              <span>Accept Artifact</span>
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
