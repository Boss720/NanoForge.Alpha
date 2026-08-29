import type { ChatAttachmentDraft } from "@/types/attachments";

export const MAX_ATTACHMENTS = 5;
export const MAX_ATTACHMENT_BYTES = 512 * 1024;
export const MAX_TOTAL_ATTACHMENT_BYTES = 1024 * 1024;

const SENSITIVE_DIRECTORIES = new Set([
  ".aws",
  ".azure",
  ".docker",
  ".gnupg",
  ".kube",
  ".ssh",
  ".terraform.d",
]);

const SENSITIVE_BASENAME_PATTERNS = [
  /^\.env(?:$|[._-])/i,
  /^(?:\.envrc|\.git-credentials|\.npmrc|\.netrc|\.pypirc|\.terraformrc)$/i,
  /^id_(?:rsa|dsa|ecdsa|ed25519)(?:$|[._-])/i,
  /(?:^|[-_.])(credentials?|secrets?|tokens?)(?:[-_.]|$)/i,
  /(?:^|[-_.])(?:private[-_.]?key|api[-_.]?key)(?:[-_.]|$)/i,
  /\.(?:pem|key|p12|pfx|jks|kdb|tfvars|tfvars\.json|secret|secrets)$/i,
  /^(?:firebase-adminsdk|service[-_.]?account)[-_.]?.*\.json$/i,
  /^(?:local\.settings|appsettings(?:\.[^.]+)?)\.json$/i,
];

const BINARY_AND_ARCHIVE_EXTENSIONS = /\.(?:exe|dll|msi|bat|cmd|com|ps1|sh|zip|rar|7z|tar|gz|bz2|xz|db|sqlite|pdf|docx?|xlsx?|pptx?)$/i;

const TEXT_EXTENSION = /\.(?:txt|md|mdx|json|jsonc|ya?ml|toml|xml|csv|ts|tsx|js|jsx|mjs|cjs|css|scss|sass|less|html?|vue|svelte|py|rb|go|rs|java|kt|kts|c|cc|cpp|cxx|h|hpp|cs|php|swift|sql|bash|zsh|fish|ini|cfg|conf|dockerfile)$/i;

export function isWorkspaceRelativePath(path: string): boolean {
  return Boolean(path) && !/^(?:[a-z]:[\\/]|[\\/]{1,2})/i.test(path) && !path.split(/[\\/]/).includes("..");
}

export function isSensitiveFileName(name: string): boolean {
  const parts = name.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.some((part) => SENSITIVE_DIRECTORIES.has(part.toLowerCase()))) {
    return true;
  }
  const basename = parts.at(-1) || name;
  return SENSITIVE_BASENAME_PATTERNS.some((pattern) => pattern.test(basename));
}

export function languageForName(name: string): string {
  const extension = name.split(".").pop()?.toLowerCase();
  const byExtension: Record<string, string> = {
    ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx", json: "json", md: "markdown",
    yml: "yaml", yaml: "yaml", py: "python", rs: "rust", go: "go", css: "css", html: "html", xml: "xml", sql: "sql",
  };
  return (extension && byExtension[extension]) || "text";
}

export function validateFileName(name: string, mimeType = ""): string | undefined {
  if (isSensitiveFileName(name) || BINARY_AND_ARCHIVE_EXTENSIONS.test(name)) {
    return "This file type may contain secrets, binaries, or archives and cannot be attached.";
  }
  if (mimeType && !mimeType.startsWith("text/") && !/(json|xml|javascript|typescript|yaml|toml|csv)/i.test(mimeType)) {
    return "Only text and code files can be attached.";
  }
  if (!TEXT_EXTENSION.test(name) && !/^text\//i.test(mimeType)) return "Only recognised text and code files can be attached.";
  return undefined;
}

export function validateTextContent(content: string): string | undefined {
  if (/\u0000/.test(content)) return "Binary files cannot be attached.";
  if (/\uFFFD/.test(content)) return "The file is not valid UTF-8 text.";
  const controls = (content.match(/[\u0001-\u0008\u000E-\u001F]/g) ?? []).length;
  if (controls > Math.max(8, content.length * 0.01)) return "Binary files cannot be attached.";
  return undefined;
}

export async function readBrowserFile(file: File): Promise<ChatAttachmentDraft> {
  const nameError = validateFileName(file.name, file.type);
  if (nameError) return failedUpload(file, nameError);
  if (file.size > MAX_ATTACHMENT_BYTES) return failedUpload(file, "Files must be 512 KiB or smaller.");

  let content: string;
  try {
    const bytes = await file.arrayBuffer();
    content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return failedUpload(file, "The file is not valid UTF-8 text.");
  }
  const contentError = validateTextContent(content);
  if (contentError) return failedUpload(file, contentError);
  return {
    id: `upload:${crypto.randomUUID()}`,
    type: "file",
    source: "upload",
    name: file.name,
    mimeType: file.type || "text/plain",
    language: languageForName(file.name),
    byteSize: file.size,
    snapshotId: crypto.randomUUID(),
    status: "ready",
    content,
    file,
  };
}

function failedUpload(file: File, error: string): ChatAttachmentDraft {
  return {
    id: `upload:${crypto.randomUUID()}`,
    type: "file",
    source: "upload",
    name: file.name,
    mimeType: file.type || "application/octet-stream",
    language: languageForName(file.name),
    byteSize: file.size,
    snapshotId: crypto.randomUUID(),
    status: "error",
    error,
    file,
  };
}

export function attachmentMetadata(attachment: ChatAttachmentDraft): Omit<ChatAttachmentDraft, "content" | "file"> {
  const { content: _content, file: _file, ...metadata } = attachment;
  return metadata;
}
