import { useState, useMemo } from "react";
import {
  Database,
  Search,
  Plus,
  Trash2,
  Edit,
  Copy,
  Check,
  Tag,
  Clock,
  FileCode,
  Layers,
  Filter,
  AlertTriangle,
  Code,
} from "lucide-react";
import type { MemoryEntry, MemoryQueryParams } from "@protocol/memory";
import type { SubagentInfo } from "@protocol/subagents";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export interface AgentMemoryViewerProps {
  sharedMemory?: MemoryEntry[];
  subagents?: SubagentInfo[];
  activeSubagentId?: string | null;
  onSetMemory?: (
    key: string,
    value: unknown,
    namespace?: string,
    ttlSeconds?: number,
    tags?: string[]
  ) => Promise<any>;
  onDeleteMemory?: (key: string, namespace?: string) => Promise<any>;
  onQueryMemory?: (params: MemoryQueryParams) => Promise<any>;
  className?: string;
}

export function calculateEntrySize(entry: MemoryEntry): number {
  try {
    const val = entry.value;
    if (val === undefined || val === null) return 0;
    const str = typeof val === "string" ? val : JSON.stringify(val);
    return new Blob([str]).size;
  } catch {
    return 0;
  }
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function getValueType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

export function getValueTypeBadgeClass(type: string): string {
  switch (type) {
    case "object":
      return "bg-purple-500/10 text-purple-400 border-purple-500/30";
    case "array":
      return "bg-blue-500/10 text-blue-400 border-blue-500/30";
    case "string":
      return "bg-emerald-500/10 text-emerald-400 border-emerald-500/30";
    case "number":
      return "bg-amber-500/10 text-amber-400 border-amber-500/30";
    case "boolean":
      return "bg-pink-500/10 text-pink-400 border-pink-500/30";
    default:
      return "bg-slate-500/10 text-slate-400 border-slate-500/30";
  }
}

export function AgentMemoryViewer({
  sharedMemory = [],
  subagents = [],
  activeSubagentId: _activeSubagentId = null,
  onSetMemory,
  onDeleteMemory,
  onQueryMemory,
  className = "",
}: AgentMemoryViewerProps) {
  const [selectedNamespace, setSelectedNamespace] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedTag, setSelectedTag] = useState<string>("all");
  const [selectedEntryKey, setSelectedEntryKey] = useState<string | null>(null);

  // Set Key Dialog State
  const [isSetDialogOpen, setIsSetDialogOpen] = useState(false);
  const [editingEntry, setEditingEntry] = useState<MemoryEntry | null>(null);
  const [formKey, setFormKey] = useState("");
  const [formNamespace, setFormNamespace] = useState("global");
  const [formValue, setFormValue] = useState("");
  const [formTags, setFormTags] = useState("");
  const [formTtl, setFormTtl] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Delete Alert State
  const [entryToDelete, setEntryToDelete] = useState<{ key: string; namespace: string } | null>(null);
  const [copiedFeedback, setCopiedFeedback] = useState(false);

  // Query Modal State
  const [isQueryModalOpen, setIsQueryModalOpen] = useState(false);
  const [queryInput, setQueryInput] = useState("");
  const [queryNamespaceInput, setQueryNamespaceInput] = useState("");
  const [queryTagInput, setQueryTagInput] = useState("");

  // Derive distinct namespaces
  const availableNamespaces = useMemo(() => {
    const set = new Set<string>(["global", "swarm"]);
    for (const entry of sharedMemory) {
      if (entry.namespace) set.add(entry.namespace);
    }
    for (const agent of subagents) {
      set.add(`agent:${agent.id}`);
    }
    return Array.from(set);
  }, [sharedMemory, subagents]);

  // Derive distinct tags
  const availableTags = useMemo(() => {
    const set = new Set<string>();
    for (const entry of sharedMemory) {
      for (const tag of entry.tags ?? []) {
        if (tag) set.add(tag);
      }
    }
    return Array.from(set);
  }, [sharedMemory]);

  // Filter entries
  const filteredEntries = useMemo(() => {
    return sharedMemory.filter((entry) => {
      const ns = entry.namespace || "global";
      if (selectedNamespace !== "all" && ns !== selectedNamespace) {
        return false;
      }
      if (selectedTag !== "all" && !(entry.tags ?? []).includes(selectedTag)) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const keyMatch = entry.key.toLowerCase().includes(q);
        const nsMatch = ns.toLowerCase().includes(q);
        const tagMatch = (entry.tags ?? []).some((t) => t.toLowerCase().includes(q));
        let valMatch = false;
        if (typeof entry.value === "string") {
          valMatch = entry.value.toLowerCase().includes(q);
        } else if (entry.value !== null && entry.value !== undefined) {
          try {
            valMatch = JSON.stringify(entry.value).toLowerCase().includes(q);
          } catch {
            valMatch = false;
          }
        }
        if (!keyMatch && !nsMatch && !tagMatch && !valMatch) return false;
      }
      return true;
    });
  }, [sharedMemory, selectedNamespace, selectedTag, searchQuery]);

  // Active selected entry
  const selectedEntry = useMemo(() => {
    if (!selectedEntryKey) {
      return filteredEntries.length > 0 ? filteredEntries[0] : null;
    }
    const [ns, key] = selectedEntryKey.includes(":::")
      ? selectedEntryKey.split(":::")
      : ["global", selectedEntryKey];
    return (
      sharedMemory.find((e) => (e.namespace || "global") === ns && e.key === key) ??
      (filteredEntries.length > 0 ? filteredEntries[0] : null)
    );
  }, [sharedMemory, selectedEntryKey, filteredEntries]);

  // Open create modal
  const handleOpenCreateModal = () => {
    setEditingEntry(null);
    setFormKey("");
    setFormNamespace(selectedNamespace !== "all" ? selectedNamespace : "global");
    setFormValue("");
    setFormTags("");
    setFormTtl("");
    setFormError(null);
    setIsSetDialogOpen(true);
  };

  // Open edit modal
  const handleOpenEditModal = (entry: MemoryEntry) => {
    setEditingEntry(entry);
    setFormKey(entry.key);
    setFormNamespace(entry.namespace || "global");
    setFormValue(
      typeof entry.value === "string"
        ? entry.value
        : JSON.stringify(entry.value, null, 2)
    );
    setFormTags((entry.tags ?? []).join(", "));
    setFormTtl(entry.ttlSeconds ? String(entry.ttlSeconds) : "");
    setFormError(null);
    setIsSetDialogOpen(true);
  };

  // Save entry handler
  const handleSaveEntry = async () => {
    if (!formKey.trim()) {
      setFormError("Key name is required.");
      return;
    }
    if (!formNamespace.trim()) {
      setFormError("Namespace is required.");
      return;
    }

    let parsedValue: unknown = formValue;
    if (formValue.trim()) {
      try {
        parsedValue = JSON.parse(formValue);
      } catch {
        // If not valid JSON, treat as raw string
        parsedValue = formValue;
      }
    }

    const tags = formTags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    const ttlSeconds = formTtl.trim() ? Number.parseInt(formTtl, 10) : undefined;
    if (ttlSeconds !== undefined && (Number.isNaN(ttlSeconds) || ttlSeconds <= 0)) {
      setFormError("TTL must be a positive integer.");
      return;
    }

    try {
      setIsSaving(true);
      setFormError(null);
      if (onSetMemory) {
        await onSetMemory(formKey.trim(), parsedValue, formNamespace.trim(), ttlSeconds, tags);
      }
      setSelectedEntryKey(`${formNamespace.trim()}:::${formKey.trim()}`);
      setIsSetDialogOpen(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
  };

  // Delete key handler
  const handleDeleteConfirm = async () => {
    if (!entryToDelete) return;
    try {
      if (onDeleteMemory) {
        await onDeleteMemory(entryToDelete.key, entryToDelete.namespace);
      }
      if (
        selectedEntry &&
        selectedEntry.key === entryToDelete.key &&
        (selectedEntry.namespace || "global") === entryToDelete.namespace
      ) {
        setSelectedEntryKey(null);
      }
    } catch {
      // ignore
    } finally {
      setEntryToDelete(null);
    }
  };

  // Copy JSON value
  const handleCopyValue = (value: unknown) => {
    const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
    void navigator.clipboard.writeText(text);
    setCopiedFeedback(true);
    setTimeout(() => setCopiedFeedback(false), 2000);
  };

  // Execute manual query
  const handleExecuteQuery = async () => {
    if (onQueryMemory) {
      const tags = queryTagInput
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      await onQueryMemory({
        query: queryInput.trim() || undefined,
        namespace: queryNamespaceInput.trim() || undefined,
        tags: tags.length > 0 ? tags : undefined,
        limit: 50,
        offset: 0,
      });
    }
    setIsQueryModalOpen(false);
  };

  return (
    <div
      className={`flex flex-col h-full bg-card font-mono text-xs select-none ${className}`}
      data-testid="agent-memory-viewer"
    >
      {/* Top Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-card/80">
        <div className="flex items-center gap-2 min-w-0">
          <div className="p-1 rounded bg-primary/10 text-primary">
            <Database className="h-4 w-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-foreground">Cross-Agent Shared Memory</span>
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-primary border-primary/30">
                {sharedMemory.length} entries
              </Badge>
            </div>
            <span className="text-[10px] text-muted-foreground hidden sm:inline">
              Workspace key-value context &amp; isolated namespaces
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            className="h-7 px-2.5 font-mono text-xs"
            onClick={handleOpenCreateModal}
            data-testid="set-memory-btn"
          >
            <Plus className="h-3.5 w-3.5 mr-1" />
            Set Key
          </Button>

          <Button
            variant="outline"
            size="sm"
            className="h-7 px-2 font-mono text-xs"
            onClick={() => setIsQueryModalOpen(true)}
            title="Execute query filter"
            data-testid="query-filter-btn"
          >
            <Filter className="h-3.5 w-3.5 mr-1" />
            Query
          </Button>
        </div>
      </div>

      {/* Filter / Search Bar */}
      <div className="flex flex-wrap items-center gap-2 p-2 border-b border-border bg-card/50">
        <div className="relative flex-1 min-w-[140px]">
          <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search keys, values, tags..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 h-8 font-mono text-xs bg-background"
            data-testid="memory-search-input"
          />
        </div>

        <select
          value={selectedNamespace}
          onChange={(e) => setSelectedNamespace(e.target.value)}
          className="h-8 rounded-md border border-input bg-background px-2 font-mono text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          aria-label="Filter by namespace"
          data-testid="namespace-select"
        >
          <option value="all">All Namespaces ({availableNamespaces.length})</option>
          {availableNamespaces.map((ns) => (
            <option key={ns} value={ns}>
              {ns}
            </option>
          ))}
        </select>

        {availableTags.length > 0 && (
          <select
            value={selectedTag}
            onChange={(e) => setSelectedTag(e.target.value)}
            className="h-8 rounded-md border border-input bg-background px-2 font-mono text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-ring"
            aria-label="Filter by tag"
          >
            <option value="all">All Tags ({availableTags.length})</option>
            {availableTags.map((tag) => (
              <option key={tag} value={tag}>
                #{tag}
              </option>
            ))}
          </select>
        )}
      </div>

      {/* Main Split Body */}
      <div className="flex-1 min-h-0 flex flex-col md:flex-row overflow-hidden">
        {/* Left Side: Keys Table/List */}
        <div className="w-full md:w-5/12 border-r border-border overflow-y-auto p-2 scrollbar-thin">
          {filteredEntries.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-center text-muted-foreground p-4">
              <Database className="h-7 w-7 mb-2 opacity-40" />
              <p className="font-semibold">No Memory Entries Found</p>
              <p className="text-[11px] text-muted-foreground/80 mt-1 max-w-xs">
                {sharedMemory.length === 0
                  ? 'Click "Set Key" to store shared context or write memory from subagent tools.'
                  : "No entries match the current filter criteria."}
              </p>
            </div>
          ) : (
            <div className="space-y-1.5">
              {filteredEntries.map((entry) => {
                const ns = entry.namespace || "global";
                const isSelected =
                  selectedEntry &&
                  selectedEntry.key === entry.key &&
                  (selectedEntry.namespace || "global") === ns;
                const valueType = getValueType(entry.value);
                const size = calculateEntrySize(entry);

                return (
                  <div
                    key={`${ns}:::${entry.key}`}
                    onClick={() => setSelectedEntryKey(`${ns}:::${entry.key}`)}
                    className={`flex flex-col p-2 rounded-lg border transition-all cursor-pointer ${
                      isSelected
                        ? "border-primary bg-primary/10 ring-1 ring-primary/40"
                        : "border-border/60 bg-card/60 hover:bg-secondary/40 hover:border-border"
                    }`}
                    data-testid={`memory-entry-row-${entry.key}`}
                  >
                    <div className="flex items-center justify-between gap-1.5">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="font-bold text-foreground truncate" title={entry.key}>
                          {entry.key}
                        </span>
                        <Badge
                          variant="secondary"
                          className="text-[9px] px-1 py-0 bg-secondary/80 text-muted-foreground"
                        >
                          {ns}
                        </Badge>
                      </div>

                      <div className="flex items-center gap-1 shrink-0">
                        <Badge
                          variant="outline"
                          className={`text-[9px] px-1 py-0 ${getValueTypeBadgeClass(valueType)}`}
                        >
                          {valueType}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground">
                          {formatBytes(size)}
                        </span>
                      </div>
                    </div>

                    <div className="mt-1 flex items-center justify-between text-[10px] text-muted-foreground">
                      <span className="truncate max-w-[150px]">
                        {typeof entry.value === "string"
                          ? entry.value.slice(0, 35)
                          : JSON.stringify(entry.value).slice(0, 35)}
                      </span>
                      <div className="flex items-center gap-1.5">
                        {entry.version > 1 && <span>v{entry.version}</span>}
                        {entry.ttlSeconds && (
                          <span className="text-amber-400 flex items-center gap-0.5">
                            <Clock className="h-2.5 w-2.5" />
                            {entry.ttlSeconds}s
                          </span>
                        )}
                      </div>
                    </div>

                    {entry.tags && entry.tags.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {entry.tags.map((t) => (
                          <span
                            key={t}
                            className="px-1 py-0 text-[9px] rounded bg-secondary text-muted-foreground flex items-center gap-0.5"
                          >
                            <Tag className="h-2 w-2" />
                            {t}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Right Side: Selected Entry Inspector */}
        <div className="flex-1 flex flex-col bg-background/40 overflow-y-auto p-3 scrollbar-thin">
          {selectedEntry ? (
            <div className="flex flex-col h-full space-y-3" data-testid="memory-inspector">
              {/* Inspector Header */}
              <div className="flex items-center justify-between border-b border-border/80 pb-2.5">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="p-1.5 rounded bg-primary/10 text-primary">
                    <FileCode className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <h3 className="font-bold text-sm text-foreground truncate" title={selectedEntry.key}>
                        {selectedEntry.key}
                      </h3>
                      <Badge variant="outline" className="text-[10px] text-primary border-primary/30">
                        {selectedEntry.namespace || "global"}
                      </Badge>
                    </div>
                    <span className="text-[10px] text-muted-foreground">
                      Version {selectedEntry.version ?? 1} &bull; Size: {formatBytes(calculateEntrySize(selectedEntry))}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs font-mono"
                    onClick={() => handleCopyValue(selectedEntry.value)}
                    title="Copy formatted JSON value"
                    data-testid="copy-value-btn"
                  >
                    {copiedFeedback ? (
                      <Check className="h-3.5 w-3.5 mr-1 text-emerald-400" />
                    ) : (
                      <Copy className="h-3.5 w-3.5 mr-1" />
                    )}
                    {copiedFeedback ? "Copied" : "Copy"}
                  </Button>

                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs font-mono text-muted-foreground hover:text-foreground"
                    onClick={() => handleOpenEditModal(selectedEntry)}
                    title="Edit entry"
                    data-testid="edit-memory-btn"
                  >
                    <Edit className="h-3.5 w-3.5 mr-1" />
                    Edit
                  </Button>

                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs font-mono text-red-400 hover:bg-red-500/10 hover:text-red-300"
                    onClick={() =>
                      setEntryToDelete({
                        key: selectedEntry.key,
                        namespace: selectedEntry.namespace || "global",
                      })
                    }
                    title="Delete key"
                    data-testid="delete-memory-btn"
                  >
                    <Trash2 className="h-3.5 w-3.5 mr-1" />
                    Delete
                  </Button>
                </div>
              </div>

              {/* Metadata Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-[11px] bg-card/60 p-2.5 rounded-lg border border-border/60">
                <div className="flex flex-col">
                  <span className="text-[10px] text-muted-foreground">Namespace</span>
                  <span className="font-semibold text-foreground truncate">
                    {selectedEntry.namespace || "global"}
                  </span>
                </div>

                <div className="flex flex-col">
                  <span className="text-[10px] text-muted-foreground">Type</span>
                  <span className="font-semibold text-foreground">
                    {getValueType(selectedEntry.value)}
                  </span>
                </div>

                <div className="flex flex-col">
                  <span className="text-[10px] text-muted-foreground">Author</span>
                  <span className="font-semibold text-foreground truncate">
                    {selectedEntry.authorName || selectedEntry.authorId || "Operator / System"}
                  </span>
                </div>

                <div className="flex flex-col">
                  <span className="text-[10px] text-muted-foreground">TTL (Expiry)</span>
                  <span className="font-semibold text-foreground">
                    {selectedEntry.ttlSeconds ? `${selectedEntry.ttlSeconds}s` : "Persistent"}
                  </span>
                </div>

                <div className="flex flex-col">
                  <span className="text-[10px] text-muted-foreground">Updated At</span>
                  <span className="font-semibold text-foreground truncate">
                    {selectedEntry.updatedAt ? new Date(selectedEntry.updatedAt).toLocaleTimeString() : "-"}
                  </span>
                </div>

                <div className="flex flex-col">
                  <span className="text-[10px] text-muted-foreground">Created At</span>
                  <span className="font-semibold text-foreground truncate">
                    {selectedEntry.createdAt ? new Date(selectedEntry.createdAt).toLocaleTimeString() : "-"}
                  </span>
                </div>

                {selectedEntry.tags && selectedEntry.tags.length > 0 && (
                  <div className="col-span-2 flex flex-col">
                    <span className="text-[10px] text-muted-foreground">Tags</span>
                    <div className="flex flex-wrap gap-1 mt-0.5">
                      {selectedEntry.tags.map((t) => (
                        <Badge key={t} variant="secondary" className="text-[9px] px-1 py-0">
                          #{t}
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              {/* Formatted JSON Value Viewer */}
              <div className="flex-1 flex flex-col min-h-[220px]">
                <div className="flex items-center justify-between px-2 py-1 bg-secondary/40 border border-border/80 rounded-t-md">
                  <span className="text-[10px] text-muted-foreground font-semibold flex items-center gap-1">
                    <Code className="h-3 w-3" />
                    Value Content ({getValueType(selectedEntry.value)})
                  </span>
                </div>

                <div
                  className="flex-1 p-3 bg-background rounded-b-md border border-t-0 border-border/80 overflow-auto font-mono text-[11px] text-foreground leading-relaxed select-text"
                  data-testid="json-content-viewer"
                >
                  <pre className="whitespace-pre-wrap break-all">
                    {typeof selectedEntry.value === "string"
                      ? selectedEntry.value
                      : JSON.stringify(selectedEntry.value, null, 2)}
                  </pre>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground p-6">
              <Layers className="h-8 w-8 mb-2 opacity-40" />
              <p className="font-semibold">No Memory Entry Selected</p>
              <p className="text-[11px] text-muted-foreground/80 mt-1">
                Select a key from the left list to inspect its values, metadata, and tags.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Set Key Modal Dialog */}
      <Dialog open={isSetDialogOpen} onOpenChange={setIsSetDialogOpen}>
        <DialogContent className="max-w-md bg-card border-border font-mono text-xs">
          <DialogHeader>
            <DialogTitle className="text-sm font-bold text-foreground flex items-center gap-2">
              <Database className="h-4 w-4 text-primary" />
              {editingEntry ? `Edit Key: ${editingEntry.key}` : "Set Shared Memory Key"}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Write or update cross-agent key-value context accessible across subagents.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            {formError && (
              <div className="p-2 rounded bg-red-500/10 border border-red-500/30 text-red-400 text-xs flex items-center gap-1.5">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                <span>{formError}</span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground font-semibold">Key Name *</label>
                <Input
                  placeholder="e.g. auth_token, user_context"
                  value={formKey}
                  onChange={(e) => setFormKey(e.target.value)}
                  disabled={!!editingEntry}
                  className="h-8 font-mono text-xs bg-background"
                  data-testid="input-memory-key"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground font-semibold">Namespace *</label>
                <Input
                  placeholder="e.g. global, swarm, agent:1"
                  value={formNamespace}
                  onChange={(e) => setFormNamespace(e.target.value)}
                  disabled={!!editingEntry}
                  className="h-8 font-mono text-xs bg-background"
                  data-testid="input-memory-namespace"
                />
              </div>
            </div>

            <div className="space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-[11px] text-muted-foreground font-semibold">Value (JSON or Text) *</label>
                <button
                  type="button"
                  onClick={() => {
                    try {
                      const formatted = JSON.stringify(JSON.parse(formValue), null, 2);
                      setFormValue(formatted);
                    } catch {
                      // ignore
                    }
                  }}
                  className="text-[10px] text-primary hover:underline"
                >
                  Format JSON
                </button>
              </div>
              <Textarea
                placeholder='{"key": "value"} or raw string'
                value={formValue}
                onChange={(e) => setFormValue(e.target.value)}
                rows={5}
                className="font-mono text-xs bg-background"
                data-testid="input-memory-value"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground font-semibold">Tags (comma-separated)</label>
                <Input
                  placeholder="e.g. cache, config, user"
                  value={formTags}
                  onChange={(e) => setFormTags(e.target.value)}
                  className="h-8 font-mono text-xs bg-background"
                  data-testid="input-memory-tags"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground font-semibold">TTL Seconds (Optional)</label>
                <Input
                  type="number"
                  placeholder="e.g. 300 (5 min)"
                  value={formTtl}
                  onChange={(e) => setFormTtl(e.target.value)}
                  className="h-8 font-mono text-xs bg-background"
                  data-testid="input-memory-ttl"
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsSetDialogOpen(false)}
              className="font-mono text-xs"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSaveEntry}
              disabled={isSaving}
              className="font-mono text-xs"
              data-testid="submit-memory-btn"
            >
              {isSaving ? "Saving..." : editingEntry ? "Update Key" : "Set Key"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Key Confirmation Alert */}
      <AlertDialog open={!!entryToDelete} onOpenChange={(open) => !open && setEntryToDelete(null)}>
        <AlertDialogContent className="max-w-md bg-card border-border font-mono text-xs">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-sm text-red-400 flex items-center gap-1.5">
              <AlertTriangle className="h-4 w-4" />
              Delete Shared Memory Key?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-xs">
              Are you sure you want to delete key{" "}
              <strong className="text-foreground">"{entryToDelete?.key}"</strong> in namespace{" "}
              <strong className="text-foreground">"{entryToDelete?.namespace}"</strong>? Any subagents relying on this context will no longer have access.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="font-mono text-xs">Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              className="bg-red-600 hover:bg-red-700 text-white font-mono text-xs"
              data-testid="confirm-delete-memory-btn"
            >
              Delete Key
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Query Filter Modal Dialog */}
      <Dialog open={isQueryModalOpen} onOpenChange={setIsQueryModalOpen}>
        <DialogContent className="max-w-md bg-card border-border font-mono text-xs">
          <DialogHeader>
            <DialogTitle className="text-sm font-bold text-foreground flex items-center gap-2">
              <Filter className="h-4 w-4 text-primary" />
              Query Shared Memory Store
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Search the host memory store with pattern queries, tag filtering, and namespace isolation.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <label className="text-[11px] text-muted-foreground font-semibold">Key/Value Pattern Query</label>
              <Input
                placeholder="e.g. auth, token, config"
                value={queryInput}
                onChange={(e) => setQueryInput(e.target.value)}
                className="h-8 font-mono text-xs bg-background"
              />
            </div>

            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground font-semibold">Namespace Filter</label>
                <Input
                  placeholder="e.g. global, swarm"
                  value={queryNamespaceInput}
                  onChange={(e) => setQueryNamespaceInput(e.target.value)}
                  className="h-8 font-mono text-xs bg-background"
                />
              </div>

              <div className="space-y-1">
                <label className="text-[11px] text-muted-foreground font-semibold">Tags (comma-separated)</label>
                <Input
                  placeholder="e.g. cache, persistent"
                  value={queryTagInput}
                  onChange={(e) => setQueryTagInput(e.target.value)}
                  className="h-8 font-mono text-xs bg-background"
                />
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsQueryModalOpen(false)}
              className="font-mono text-xs"
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleExecuteQuery}
              className="font-mono text-xs"
            >
              Execute Query
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
