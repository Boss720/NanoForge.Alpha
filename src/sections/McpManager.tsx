import { useState } from "react";
import { Server, Activity, Wrench, ShieldAlert, KeyRound, Play, TerminalSquare, Boxes } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export interface McpServerRow {
  id: string;
  name: string;
  command: string;
  args?: string[];
  tools: string[];
  secretRefs?: string[];
  enabled: boolean;
  health: "ok" | "error" | "checking" | "unknown";
  lastError?: string | null;
}

export function McpManager({
  mcpServers,
  onToggleMcpServer,
  onCheckHealth,
}: {
  mcpServers: McpServerRow[];
  onToggleMcpServer: (id: string, enabled: boolean) => void;
  onCheckHealth?: (kind: "mcp", id: string) => void;
}) {
  const [isAddWizardOpen, setIsAddWizardOpen] = useState(false);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Server className="w-5 h-5" /> MCP Servers
          </h2>
          <p className="text-sm text-muted-foreground">Manage and test Model Context Protocol servers</p>
        </div>
        <Dialog open={isAddWizardOpen} onOpenChange={setIsAddWizardOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="gap-2"><Boxes className="w-4 h-4" /> Add Server</Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-[600px]">
            <DialogHeader>
              <DialogTitle>Add MCP Server Wizard</DialogTitle>
            </DialogHeader>
            <Tabs defaultValue="stdio" className="mt-4">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="stdio">STDIO</TabsTrigger>
                <TabsTrigger value="sse">SSE</TabsTrigger>
              </TabsList>
              <TabsContent value="stdio" className="grid gap-4 mt-4">
                <div className="grid gap-2">
                  <Label>Command</Label>
                  <Input placeholder="e.g. npx" />
                </div>
                <div className="grid gap-2">
                  <Label>Arguments (comma separated)</Label>
                  <Input placeholder="-y, @modelcontextprotocol/server-postgres" />
                </div>
                <div className="grid gap-2">
                  <Label>Environment Secrets</Label>
                  <Input placeholder="DATABASE_URL=env:PG_URL" />
                </div>
                <div className="grid gap-2">
                  <Label>Tools Allowlist</Label>
                  <Input placeholder="query_db, list_tables" />
                </div>
              </TabsContent>
              <TabsContent value="sse" className="grid gap-4 mt-4">
                <div className="grid gap-2">
                  <Label>URL</Label>
                  <Input placeholder="http://localhost:3001/sse" />
                </div>
              </TabsContent>
            </Tabs>
            <div className="flex justify-end gap-2 mt-4">
              <Button variant="outline" onClick={() => setIsAddWizardOpen(false)}>Cancel</Button>
              <Button onClick={() => setIsAddWizardOpen(false)}>Save Server</Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>

      <div className="grid gap-3">
        {mcpServers.map((server) => (
          <div key={server.id} data-integration-id={server.id} className="border border-border bg-card rounded-lg p-4 flex flex-col gap-3">
            <div className="flex items-start justify-between">
              <div>
                <h3 className="font-semibold text-sm flex items-center gap-2">
                  {server.name}
                  {server.health === "ok" && <Badge className="bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20" variant="secondary">OK</Badge>}
                  {server.health === "error" && <Badge className="bg-red-500/10 text-red-500 hover:bg-red-500/20" variant="secondary">Error</Badge>}
                  {server.health === "unknown" && <Badge className="bg-amber-500/10 text-amber-500 hover:bg-amber-500/20" variant="secondary">Unknown</Badge>}
                  {server.health === "checking" && <Badge className="bg-blue-500/10 text-blue-500 hover:bg-blue-500/20 animate-pulse" variant="secondary">Checking</Badge>}
                </h3>
                <p className="text-xs font-mono text-muted-foreground mt-1 flex items-center gap-1">
                  <TerminalSquare className="w-3 h-3" /> {server.command} {server.args?.join(" ")}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button 
                  variant="outline" 
                  size="icon" 
                  className="h-8 w-8"
                  onClick={() => onCheckHealth?.("mcp", server.id)}
                  title="Test Connection"
                >
                  <Activity className="w-4 h-4 text-muted-foreground" />
                </Button>
                <Switch 
                  checked={server.enabled} 
                  onCheckedChange={(v) => onToggleMcpServer(server.id, v)} 
                  aria-label={`enable ${server.name}`}
                />
              </div>
            </div>

            {server.lastError && (
              <div className="bg-red-500/10 border border-red-500/20 text-red-400 text-xs p-2 rounded-md font-mono flex gap-2">
                <ShieldAlert className="w-4 h-4 shrink-0" />
                <span>{server.lastError}</span>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-2 mt-2">
              {server.tools.map(t => (
                <Badge key={t} variant="secondary" className="text-[10px] font-mono gap-1 cursor-pointer hover:bg-secondary/80">
                  <Wrench className="w-3 h-3" /> {t}
                </Badge>
              ))}
              {server.secretRefs?.map(ref => (
                <Badge key={ref} variant="outline" className="text-[10px] font-mono gap-1 text-muted-foreground">
                  <KeyRound className="w-3 h-3" /> {ref}
                </Badge>
              ))}
            </div>

            <div className="mt-2 pt-3 border-t border-border flex justify-end gap-2">
               <Dialog>
                 <DialogTrigger asChild>
                   <Button variant="ghost" size="sm" className="h-7 text-xs gap-1">
                     <Play className="w-3 h-3" /> Live Tool Tester
                   </Button>
                 </DialogTrigger>
                 <DialogContent>
                    <DialogHeader>
                      <DialogTitle>Live Tool Tester: {server.name}</DialogTitle>
                    </DialogHeader>
                    <div className="py-4 grid gap-4">
                       <div className="grid gap-2">
                         <Label>Select Tool</Label>
                         <select className="flex h-10 w-full items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm">
                           {server.tools.map(t => <option key={t} value={t}>{t}</option>)}
                         </select>
                       </div>
                       <div className="grid gap-2">
                         <Label>Arguments (JSON)</Label>
                         <textarea className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm font-mono" defaultValue="{}" />
                       </div>
                       <Button className="w-full">Execute</Button>
                       <div className="grid gap-2 mt-2">
                         <Label>Result / Logs</Label>
                         <div className="bg-muted p-3 rounded-md font-mono text-xs h-24 overflow-auto text-muted-foreground">
                           Waiting for execution...
                         </div>
                       </div>
                    </div>
                 </DialogContent>
               </Dialog>
            </div>
          </div>
        ))}
        {mcpServers.length === 0 && (
          <div className="text-center py-8 text-sm text-muted-foreground border border-dashed rounded-lg">
            No MCP servers configured. Add one to expand capabilities.
          </div>
        )}
      </div>
    </div>
  );
}
