import { useState } from "react";
import { BookOpen, FileText, Wrench, Check, Hash, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";


export interface SkillRow {
  id: string;
  name: string;
  description: string;
  allowedTools: string[];
  instructions: string;
  hashValid: boolean;
  enabled: boolean;
  health: "ok" | "error" | "checking" | "unknown";
}

export function SkillStudio({
  skills,
  onToggleSkill,
}: {
  skills: SkillRow[];
  onToggleSkill: (id: string, enabled: boolean) => void;
}) {
  const [wizardStep, setWizardStep] = useState(1);
  const [isWizardOpen, setIsWizardOpen] = useState(false);
  const [viewedInstructions, setViewedInstructions] = useState<Record<string, boolean>>({});

  const markViewed = (id: string) => {
    setViewedInstructions((prev) => ({ ...prev, [id]: true }));
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <BookOpen className="w-5 h-5" /> Skill Studio
          </h2>
          <p className="text-sm text-muted-foreground">Manage active and quarantined skills</p>
        </div>
        <Dialog open={isWizardOpen} onOpenChange={setIsWizardOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-2"><Plus className="w-4 h-4" /> Create Skill</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[600px]">
            <DialogHeader>
              <DialogTitle>Skill Creator Wizard - Step {wizardStep}</DialogTitle>
            </DialogHeader>
            <div className="py-4">
              {wizardStep === 1 && (
                <div className="grid gap-4">
                  <div className="grid gap-2">
                    <Label>Skill Name</Label>
                    <Input placeholder="e.g. data-analyzer" />
                  </div>
                  <div className="grid gap-2">
                    <Label>Description</Label>
                    <Input placeholder="Describe what this skill does" />
                  </div>
                </div>
              )}
              {wizardStep === 2 && (
                <div className="grid gap-2">
                  <Label>Instructions (Markdown)</Label>
                  <Textarea className="h-48 font-mono text-sm" placeholder="Write skill instructions here..." />
                </div>
              )}
              {wizardStep === 3 && (
                <div className="grid gap-4">
                  <Label>Allowed Tools</Label>
                  <div className="flex items-center gap-2">
                    <Switch id="tool-search" /> <Label htmlFor="tool-search">search_web</Label>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch id="tool-file" /> <Label htmlFor="tool-file">read_file</Label>
                  </div>
                </div>
              )}
              {wizardStep === 4 && (
                <div className="grid gap-4">
                  <Label>Preview & Hash</Label>
                  <div className="bg-muted p-4 rounded-md font-mono text-xs overflow-auto h-32">
                    Preview of instructions...
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Hash className="w-4 h-4" /> SHA-256: e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
                  </div>
                </div>
              )}
              {wizardStep === 5 && (
                <div className="py-8 text-center grid gap-2">
                  <Check className="w-12 h-12 text-green-500 mx-auto" />
                  <h3 className="text-lg font-medium">Skill Saved Successfully!</h3>
                </div>
              )}
            </div>
            <div className="flex justify-between mt-4">
              <Button disabled={wizardStep === 1} variant="outline" onClick={() => setWizardStep(s => s - 1)}>Back</Button>
              {wizardStep < 5 ? (
                <Button onClick={() => setWizardStep(s => s + 1)}>Next</Button>
              ) : (
                <Button onClick={() => { setIsWizardOpen(false); setWizardStep(1); }}>Done</Button>
              )}
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-3">
        {skills.map((skill) => {
          const isViewed = viewedInstructions[skill.id] || skill.enabled;
          const canEnable = skill.hashValid && isViewed;

          return (
            <div key={skill.id} data-integration-id={skill.id} className="border border-border bg-card rounded-lg p-4 flex flex-col gap-3">
              <div className="flex items-start justify-between">
                <div>
                  <h3 className="font-semibold text-sm flex items-center gap-2">
                    {skill.name}
                    {skill.hashValid ? (
                      <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20">Active</Badge>
                    ) : (
                      <Badge variant="secondary" className="bg-amber-500/10 text-amber-500 hover:bg-amber-500/20">Quarantined</Badge>
                    )}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-1">{skill.description}</p>
                  {!skill.hashValid && (
                    <p className="mt-1 text-xs text-red-400 font-mono">hash mismatch</p>
                  )}
                </div>
                <Switch 
                  checked={skill.enabled} 
                  onCheckedChange={(v) => onToggleSkill(skill.id, v)} 
                  disabled={!canEnable}
                  aria-label={`enable ${skill.name}`}
                />
              </div>

              <div className="flex items-center gap-2 mt-2">
                {skill.allowedTools.map(t => (
                  <Badge key={t} variant="outline" className="text-[10px] font-mono gap-1">
                    <Wrench className="w-3 h-3" /> {t}
                  </Badge>
                ))}
              </div>

              <div className="flex flex-col gap-2 mt-2">
                <Button 
                  variant="secondary" 
                  size="sm" 
                  className="h-7 text-xs w-fit gap-1"
                  onClick={() => markViewed(skill.id)}
                >
                  <FileText className="w-3 h-3" /> view instructions
                </Button>

                {isViewed && (
                  <div className="mt-1 rounded border border-border/80 bg-muted/40 p-3 font-mono text-xs">
                    <pre className="whitespace-pre-wrap break-words">{skill.instructions}</pre>
                  </div>
                )}
              </div>
            </div>
          );
        })}
        {skills.length === 0 && (
          <div className="text-center py-8 text-sm text-muted-foreground border border-dashed rounded-lg">
            No skills available. Create one to get started.
          </div>
        )}
      </div>
    </div>
  );
}
