import React, { useState, useEffect } from 'react';
import {
  FileCode2,
  FileJson2,
  FileText,
  File as FileIconDefault,
  Folder,
  FolderOpen,
  Image as FileImageIcon,
  Settings,
  Search,
  RefreshCw,
  X,
  ChevronRight,
  ChevronDown,
  Loader2
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { formatErrorMessage } from '@/lib/statusFormatter';
import type { FileTreeNode, SearchMatch } from '@/types/workspace';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';

export interface WorkspaceExplorerProps {
  tree: FileTreeNode[];
  activeFile?: string;
  onFileSelect: (path: string) => void;
  onRefresh: () => void;
  onSearch: (query: string) => void;
  onLoadDirectory?: (path: string) => Promise<void> | void;
  onAttachToChat?: (path: string) => void;
  onRevealPath?: (path: string) => Promise<boolean> | boolean;
  searchResults?: SearchMatch[];
  error?: string | null;
  isConnected: boolean;
  className?: string;
}

function getFileIcon(filename: string, isDir: boolean, isOpen: boolean) {
  if (isDir) {
    return isOpen ? <FolderOpen className="h-4 w-4 text-blue-400" /> : <Folder className="h-4 w-4 text-blue-400" />;
  }
  
  const ext = filename.split('.').pop()?.toLowerCase();
  
  if (['ts', 'tsx', 'js', 'jsx'].includes(ext || '')) return <FileCode2 className="h-4 w-4 text-blue-400" />;
  if (['json'].includes(ext || '')) return <FileJson2 className="h-4 w-4 text-yellow-400" />;
  if (['md', 'txt'].includes(ext || '')) return <FileText className="h-4 w-4 text-gray-400" />;
  if (['png', 'jpg', 'jpeg', 'svg', 'gif'].includes(ext || '')) return <FileImageIcon className="h-4 w-4 text-purple-400" />;
  if (['config', 'env', 'yml', 'yaml'].some(sub => filename.includes(sub))) return <Settings className="h-4 w-4 text-gray-500" />;
  
  return <FileIconDefault className="h-4 w-4 text-gray-400" />;
}

function getGitBadge(status?: string) {
  if (!status) return null;
  const colors: Record<string, string> = {
    'M': 'text-orange-400',
    'A': 'text-green-400',
    'D': 'text-red-400',
    '?': 'text-gray-400',
    '!': 'text-gray-400',
  };
  const colorClass = colors[status] || 'text-gray-400';
  return <span className={cn("ml-auto font-mono text-[10.5px] font-bold px-1", colorClass)}>{status}</span>;
}

function formatSize(bytes?: number) {
  if (bytes === undefined) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const TreeNode: React.FC<{
  node: FileTreeNode;
  depth: number;
  activeFile?: string;
  onSelect: (path: string) => void;
  onLoadDirectory?: (path: string) => Promise<void> | void;
  onAttachToChat?: (path: string) => void;
  onRevealPath?: (path: string) => Promise<boolean> | boolean;
}> = ({ node, depth, activeFile, onSelect, onLoadDirectory, onAttachToChat, onRevealPath }) => {
  const [isExpanded, setIsExpanded] = useState(node.expanded ?? false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    if (node.expanded !== undefined) {
      setIsExpanded(node.expanded);
    }
  }, [node.expanded]);

  const toggleExpand = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!node.isDir) return;
    
    if (!isExpanded && !node.children) {
      setIsLoading(true);
      Promise.resolve(onLoadDirectory?.(node.path)).finally(() => {
        setIsLoading(false);
        setIsExpanded(true);
      });
    } else {
      setIsExpanded(!isExpanded);
    }
  };

  const handleSelect = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (node.isDir) {
      toggleExpand(e);
    } else {
      onSelect(node.path);
    }
  };

  const isSelected = activeFile === node.path;
  const childCount = node.children ? node.children.length : 0;

  return (
    <div>
      <ContextMenu>
        <ContextMenuTrigger>
          <div
            onClick={handleSelect}
            className={cn(
              "group flex cursor-pointer items-center gap-1.5 py-1 pr-2 transition-colors hover:bg-accent/50",
              isSelected && "bg-accent text-accent-foreground"
            )}
            style={{ paddingLeft: `${depth * 12 + 8}px` }}
            title={`${node.path}${node.size ? ` - ${formatSize(node.size)}` : ''}`}
          >
            <div className="flex h-4 w-4 shrink-0 items-center justify-center">
              {node.isDir && (
                isLoading ? (
                  <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                ) : isExpanded ? (
                  <ChevronDown className="h-3 w-3 text-muted-foreground transition-transform" />
                ) : (
                  <ChevronRight className="h-3 w-3 text-muted-foreground transition-transform" />
                )
              )}
            </div>

            <div className="flex h-4 w-4 shrink-0 items-center justify-center">
              {getFileIcon(node.name, node.isDir, isExpanded)}
            </div>

            <span className={cn(
              "truncate font-mono text-[11.5px] transition-colors",
              !isSelected && "text-muted-foreground group-hover:text-foreground"
            )}>
              {node.name}
            </span>

            {node.isDir && childCount > 0 && !isExpanded && (
              <span className="ml-1 text-[10.5px] text-muted-foreground/60 opacity-0 transition-opacity group-hover:opacity-100">
                ({childCount})
              </span>
            )}

            {getGitBadge(node.gitStatus)}

            {!node.isDir && node.size && (
              <span className="ml-auto hidden text-[10.5px] text-muted-foreground/50 group-hover:inline-block">
                {formatSize(node.size)}
              </span>
            )}
          </div>
        </ContextMenuTrigger>
        <ContextMenuContent className="w-48">
          <ContextMenuItem onClick={() => node.isDir ? null : onSelect(node.path)}>
            Open
          </ContextMenuItem>
          {!node.isDir && onAttachToChat && <ContextMenuItem onClick={() => onAttachToChat(node.path)}>
            Attach to chat
          </ContextMenuItem>}
          <ContextMenuItem onClick={() => navigator.clipboard.writeText(node.path)}>
            Copy Relative Path
          </ContextMenuItem>
          <ContextMenuItem onClick={() => navigator.clipboard.writeText(`/${node.path}`)}>
            Copy Path
          </ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem disabled={!onRevealPath} onClick={() => { if (onRevealPath) void onRevealPath(node.path); }}>
            Reveal in Explorer
          </ContextMenuItem>
        </ContextMenuContent>
      </ContextMenu>

      {node.isDir && isExpanded && node.children && (
        <div className="relative overflow-hidden transition-all duration-300 ease-in-out">
          <div 
            className="absolute bottom-0 left-[calc(1.5rem-1px)] top-0 w-px bg-border/50" 
            style={{ left: `${depth * 12 + 16}px` }} 
          />
          {node.children.map((child) => (
            <TreeNode 
              key={child.path} 
              node={child} 
              depth={depth + 1} 
              activeFile={activeFile} 
              onSelect={onSelect}
              onLoadDirectory={onLoadDirectory}
              onAttachToChat={onAttachToChat}
              onRevealPath={onRevealPath}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export function WorkspaceExplorer({
  tree,
  activeFile,
  onFileSelect,
  onRefresh,
  onSearch,
  onLoadDirectory,
  onAttachToChat,
  onRevealPath,
  searchResults,
  error,
  isConnected,
  className
}: WorkspaceExplorerProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [filterQuery, setFilterQuery] = useState('');
  
  useEffect(() => {
    const timer = setTimeout(() => {
      onSearch(searchQuery);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery, onSearch]);

  const clearSearch = () => {
    setSearchQuery('');
  };

  const isSearching = searchQuery.trim().length > 0;

  // Local file tree filtering (M5): filter nodes by name without hitting the host
  const filterTree = (nodes: FileTreeNode[], query: string): FileTreeNode[] => {
    if (!query.trim()) return nodes;
    const lowerQuery = query.toLowerCase();
    return nodes.reduce<FileTreeNode[]>((acc, node) => {
      const nameMatch = node.name.toLowerCase().includes(lowerQuery);
      if (node.isDir && node.children) {
        const filteredChildren = filterTree(node.children, query);
        if (nameMatch || filteredChildren.length > 0) {
          acc.push({ ...node, children: filteredChildren, expanded: true });
        }
      } else if (nameMatch) {
        acc.push(node);
      }
      return acc;
    }, []);
  };

  const displayTree = filterQuery ? filterTree(tree, filterQuery) : tree;

  // Breadcrumb from active file path (M5)
  const breadcrumbs = activeFile ? activeFile.split('/').filter(Boolean) : [];

  return (
    <div className={cn("flex flex-col h-full bg-card/30 border-r border-border w-64", className)}>
      <div className="p-3 border-b border-border flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="micro-label nf-sidebar-label">Workspace</span>
          <button 
            onClick={onRefresh}
            disabled={!isConnected}
            className="p-1 rounded text-muted-foreground hover:bg-accent hover:text-foreground transition-colors disabled:opacity-50"
            title="Refresh Explorer"
            aria-label="Refresh file explorer"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Breadcrumb navigation (M5) */}
        {breadcrumbs.length > 1 && (
          <div className="flex items-center gap-0.5 text-[10px] text-muted-foreground overflow-hidden" aria-label="File path breadcrumbs">
            {breadcrumbs.map((crumb, i) => (
              <React.Fragment key={i}>
                {i > 0 && <ChevronRight className="h-2.5 w-2.5 shrink-0" />}
                <span className={cn("truncate", i === breadcrumbs.length - 1 && "text-foreground font-medium")}>{crumb}</span>
              </React.Fragment>
            ))}
          </div>
        )}
        
        {/* File filter input (M5) */}
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input 
            value={isSearching ? searchQuery : filterQuery}
            onChange={(e) => {
              const value = e.target.value;
              // If it looks like a content search (3+ chars), use host search
              if (value.length >= 3) {
                setSearchQuery(value);
                setFilterQuery('');
              } else {
                // Short queries filter locally by filename
                setFilterQuery(value);
                setSearchQuery('');
              }
            }}
            placeholder="Filter or search files..."
            className="h-7 text-xs pl-7 pr-7 bg-background/50 focus-visible:ring-1"
            aria-label="Filter files by name or search file contents"
          />
          {(searchQuery || filterQuery) && (
            <button 
              onClick={() => { clearSearch(); setFilterQuery(''); }}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 text-muted-foreground hover:text-foreground"
              aria-label="Clear filter"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
      </div>

      <ScrollArea className="flex-1">
        <div className="py-2">
          {error && (
            <p role="alert" className="mx-2 mb-2 rounded border border-destructive/30 bg-destructive/10 px-2 py-1.5 font-mono text-[10px] text-destructive">
              {formatErrorMessage(error)}
            </p>
          )}
          {isSearching ? (
            <div className="px-2">
              <div className="text-[10px] text-muted-foreground mb-2 px-1 font-mono uppercase tracking-wider">
                Search Results {searchResults ? `(${searchResults.length})` : ''}
              </div>
              {searchResults && searchResults.length >= 100 && (
                <p className="mb-2 px-1 text-[9px] text-amber-400/80 font-mono" role="status">
                  Results may be incomplete — refine your query for more precise matches.
                </p>
              )}
              {searchResults?.map((match, i) => (
                <div 
                  key={`${match.file}-${i}`}
                  onClick={() => onFileSelect(match.file)}
                  className="group cursor-pointer rounded px-2 py-1.5 hover:bg-accent/50 mb-1"
                >
                  <div className="flex items-center gap-1.5 text-[11.5px] font-mono text-foreground mb-0.5">
                    {getFileIcon(match.file, false, false)}
                    <span className="truncate">{match.file.split('/').pop()}</span>
                    <span className="ml-auto text-[10.5px] text-muted-foreground">:{match.line}</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground truncate pl-5">
                    {match.file}
                  </div>
                </div>
              ))}
              {searchResults?.length === 0 && (
                <div className="text-[11.5px] text-muted-foreground px-1 py-2 text-center font-mono">
                  No files found.
                </div>
              )}
            </div>
          ) : displayTree.length === 0 ? (
            <div className="mx-3 my-4 rounded-lg border border-dashed border-border/80 p-4 text-center space-y-2" data-testid="explorer-empty-state">
              <Folder className="h-6 w-6 text-muted-foreground/60 mx-auto" />
              <p className="font-mono text-xs text-foreground font-semibold">
                {filterQuery ? 'No matching files' : 'No files in workspace'}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {filterQuery
                  ? 'Try a different filter term.'
                  : 'Open a local folder or refresh to explore workspace files.'}
              </p>
              {isConnected && !filterQuery && (
                <button
                  type="button"
                  onClick={onRefresh}
                  className="inline-flex items-center justify-center gap-1.5 rounded-md bg-secondary px-3 py-1 font-mono text-xs text-foreground hover:bg-secondary/80 transition-colors"
                >
                  <RefreshCw className="h-3 w-3" /> Refresh
                </button>
              )}
            </div>
          ) : (
            <div>
              {displayTree.map(node => (
                <TreeNode 
                  key={node.path} 
                  node={node} 
                  depth={0} 
                  activeFile={activeFile} 
                  onSelect={onFileSelect}
                  onLoadDirectory={onLoadDirectory}
                  onAttachToChat={onAttachToChat}
                  onRevealPath={onRevealPath}
                />
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

/** Returns a human-readable preview state for files that can't be normally opened. */
export function getFilePreviewState(file: { path: string; size?: number; error?: string }): {
  blocked: boolean;
  reason: string;
  action?: string;
} | null {
  if (file.error) {
    if (file.error.includes("EACCES") || file.error.includes("EPERM")) {
      return { blocked: true, reason: "This file is locked or you don't have permission to read it.", action: "Check file permissions" };
    }
    if (file.error.includes("encoding") || file.error.includes("EILSEQ")) {
      return { blocked: true, reason: "This file uses an unsupported text encoding.", action: "Open in an external editor" };
    }
    return { blocked: true, reason: file.error };
  }
  const ext = file.path.split(".").pop()?.toLowerCase() ?? "";
  const binaryExts = ["exe", "dll", "so", "dylib", "bin", "dat", "zip", "tar", "gz", "7z", "rar", "png", "jpg", "jpeg", "gif", "webp", "ico", "mp3", "mp4", "avi", "mov", "woff", "woff2", "ttf", "otf", "pdf"];
  if (binaryExts.includes(ext)) {
    return { blocked: true, reason: `Binary file (.${ext}) — cannot be displayed as text.`, action: "Open in default application" };
  }
  if (file.size !== undefined && file.size > 1024 * 1024) {
    const sizeMB = (file.size / (1024 * 1024)).toFixed(1);
    return { blocked: true, reason: `File is too large to preview (${sizeMB} MB).`, action: "Open in external editor" };
  }
  return null;
}
