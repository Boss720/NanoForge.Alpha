import { useState } from "react";
import { Plug, Box, Download, Plus, BookOpen, Server, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RowShell } from "@/sections/IntegrationsPanel";
import type { IntegrationHealth } from "@/sections/IntegrationsPanel";

export interface PluginRow {
  id: string;
  name: string;
  enabled: boolean;
  health: IntegrationHealth;
  lastError?: string | null;
  version?: string;
  skillsCount?: number;
  rulesCount?: number;
  mcpServersCount?: number;
}



export function PluginManager({ 
  plugins,
  onTogglePlugin,
}: { 
  plugins: PluginRow[];
  onTogglePlugin: (id: string, enabled: boolean) => void;
}) {
  const [isInstallOpen, setIsInstallOpen] = useState(false);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [selectedPlugin, setSelectedPlugin] = useState<PluginRow | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
         <div>
           <h2 className="text-lg font-semibold flex items-center gap-2">
             <Plug className="w-5 h-5" /> Plugin Manager
           </h2>
           <p className="text-sm text-muted-foreground">Manage installed plugins and packages</p>
         </div>
         <div className="flex gap-2">
           <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
             <DialogTrigger asChild>
               <Button variant="outline" size="sm" className="gap-2"><Plus className="w-4 h-4" /> Create</Button>
             </DialogTrigger>
             <DialogContent>
                <DialogHeader>
                  <DialogTitle>Create Plugin Package</DialogTitle>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <div className="grid gap-2">
                    <Label>Plugin Name</Label>
                    <Input placeholder="e.g. dev-toolkit" />
                  </div>
                  <div className="grid gap-2">
                    <Label>Version</Label>
                    <Input placeholder="1.0.0" defaultValue="1.0.0" />
                  </div>
                  <div className="grid gap-2 mt-2">
                    <Label>Include Components</Label>
                    <div className="flex items-center gap-2">
                      <Switch id="inc-skills" defaultChecked /> <Label htmlFor="inc-skills">Skills</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch id="inc-rules" defaultChecked /> <Label htmlFor="inc-rules">Governance Rules</Label>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch id="inc-mcp" defaultChecked /> <Label htmlFor="inc-mcp">MCP Servers</Label>
                    </div>
                  </div>
                </div>
                <div className="flex justify-end gap-2 mt-2">
                  <Button variant="outline" onClick={() => setIsCreateOpen(false)}>Cancel</Button>
                  <Button onClick={() => setIsCreateOpen(false)}>Package Plugin</Button>
                </div>
             </DialogContent>
           </Dialog>

           <Dialog open={isInstallOpen} onOpenChange={setIsInstallOpen}>
             <DialogTrigger asChild>
               <Button size="sm" className="gap-2"><Download className="w-4 h-4" /> Install</Button>
             </DialogTrigger>
             <DialogContent>
                <DialogHeader>
                  <DialogTitle>Install Plugin</DialogTitle>
                </DialogHeader>
                <Tabs defaultValue="local" className="mt-4">
                  <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="local">Local Folder</TabsTrigger>
                    <TabsTrigger value="url">ZIP URL</TabsTrigger>
                  </TabsList>
                  <TabsContent value="local" className="grid gap-4 mt-4">
                    <div className="grid gap-2">
                      <Label>Path to Plugin Directory</Label>
                      <div className="flex gap-2">
                        <Input placeholder="C:\path\to\plugin" />
                        <Button variant="outline">Browse</Button>
                      </div>
                    </div>
                  </TabsContent>
                  <TabsContent value="url" className="grid gap-4 mt-4">
                    <div className="grid gap-2">
                      <Label>Plugin ZIP URL</Label>
                      <Input placeholder="https://github.com/org/repo/archive/main.zip" />
                    </div>
                  </TabsContent>
                </Tabs>
                <div className="flex justify-end gap-2 mt-4">
                  <Button variant="outline" onClick={() => setIsInstallOpen(false)}>Cancel</Button>
                  <Button onClick={() => setIsInstallOpen(false)}>Install</Button>
                </div>
             </DialogContent>
           </Dialog>
         </div>
      </div>

      <div className="grid gap-3">
         {plugins.map(plugin => (
            <RowShell
              key={plugin.id}
              name={plugin.name}
              sub={plugin.id}
              enabled={plugin.enabled}
              onToggle={(v) => onTogglePlugin(plugin.id, v)}
              health={plugin.health}
              lastError={plugin.lastError}
              kind="plugin"
              id={plugin.id}
            />
          ))}
         {plugins.length === 0 && (
            <p className="px-3 py-3 font-mono text-[11px] text-muted-foreground">none configured</p>
          )}
      </div>

      <Dialog open={!!selectedPlugin} onOpenChange={(open) => !open && setSelectedPlugin(null)}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Box className="w-5 h-5 text-primary" /> {selectedPlugin?.name}
            </DialogTitle>
          </DialogHeader>
          <div className="py-4">
            <div className="flex items-center gap-2 mb-6">
              <Badge variant="outline">v{selectedPlugin?.version}</Badge>
              {selectedPlugin?.enabled ? (
                <Badge className="bg-emerald-500/10 text-emerald-500">Active</Badge>
              ) : (
                <Badge className="bg-secondary text-muted-foreground">Disabled</Badge>
              )}
            </div>
            
            <h4 className="font-medium text-sm mb-3">Provided Components</h4>
            <div className="grid gap-2">
              <div className="flex justify-between items-center p-2 rounded-md border bg-muted/50">
                <span className="text-sm flex items-center gap-2"><BookOpen className="w-4 h-4" /> Skills</span>
                <span className="font-mono text-xs">{selectedPlugin?.skillsCount}</span>
              </div>
              <div className="flex justify-between items-center p-2 rounded-md border bg-muted/50">
                <span className="text-sm flex items-center gap-2"><Shield className="w-4 h-4" /> Rules</span>
                <span className="font-mono text-xs">{selectedPlugin?.rulesCount}</span>
              </div>
              <div className="flex justify-between items-center p-2 rounded-md border bg-muted/50">
                <span className="text-sm flex items-center gap-2"><Server className="w-4 h-4" /> MCP Servers</span>
                <span className="font-mono text-xs">{selectedPlugin?.mcpServersCount}</span>
              </div>
            </div>
          </div>
          <div className="flex justify-between mt-2">
            <Button variant="destructive" size="sm">Uninstall</Button>
            <Button variant="outline" onClick={() => setSelectedPlugin(null)}>Close</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
