export interface DirEntry {
  name: string;
  isDir: boolean;
  size?: number;
  modified?: string;
}

export interface FileStat {
  size: number;
  modified: string;
  isDir: boolean;
  isFile: boolean;
}

export interface SearchMatch {
  file: string;
  line: number;
  column: number;
  text: string;
  matchText: string;
}

export interface GitFileStatus {
  path: string;
  status: 'M' | 'A' | 'D' | 'R' | '?' | '!';
}

export interface FileTreeNode {
  name: string;
  path: string;       // workspace-relative path
  isDir: boolean;
  size?: number;
  modified?: string;
  children?: FileTreeNode[];
  expanded?: boolean;
  loading?: boolean;
  gitStatus?: 'M' | 'A' | 'D' | 'R' | '?' | '!';
}
