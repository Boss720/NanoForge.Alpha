const SENSITIVE_DIRECTORY_NAMES = new Set([
  '.aws',
  '.azure',
  '.docker',
  '.gnupg',
  '.kube',
  '.ssh',
  '.terraform.d',
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

/** Glob forms are used to stop ripgrep from opening sensitive files at all. */
export const SENSITIVE_WORKSPACE_GLOB_PATTERNS = [
  '**/.env',
  '**/.env.*',
  '**/.envrc',
  '**/.git-credentials',
  '**/.npmrc',
  '**/.netrc',
  '**/.pypirc',
  '**/.aws/**',
  '**/.azure/**',
  '**/.docker/**',
  '**/.gnupg/**',
  '**/.kube/**',
  '**/.ssh/**',
  '**/.terraform.d/**',
  '**/credentials',
  '**/credentials.*',
  '**/credential.json',
  '**/secrets',
  '**/secrets.*',
  '**/secret.json',
  '**/tokens',
  '**/tokens.*',
  '**/token.json',
  '**/*-credentials.*',
  '**/*_credentials.*',
  '**/*.credentials.*',
  '**/*-secret.*',
  '**/*_secret.*',
  '**/*.secret.*',
  '**/*-token.*',
  '**/*_token.*',
  '**/*.token.*',
  '**/*-private-key*',
  '**/*_private-key*',
  '**/id_rsa*',
  '**/id_dsa*',
  '**/id_ecdsa*',
  '**/id_ed25519*',
  '**/*.pem',
  '**/*.key',
  '**/*.p12',
  '**/*.pfx',
  '**/*.jks',
  '**/*.tfvars',
  '**/*.tfvars.json',
];

const normalizeParts = (value: string): string[] => {
  const parts: string[] = [];
  for (const part of value.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      parts.pop();
      continue;
    }
    parts.push(part.toLowerCase());
  }
  return parts;
};

/**
 * Returns true for workspace-relative paths that commonly contain credentials
 * or secret configuration. Matching is case-insensitive and separator-agnostic
 * so callers can safely use paths from Windows or POSIX watcher/search output.
 */
export function isSensitiveWorkspacePath(workspaceRelativePath: string): boolean {
  const parts = normalizeParts(workspaceRelativePath);
  if (parts.some((part) => SENSITIVE_DIRECTORY_NAMES.has(part))) return true;
  const basename = parts.at(-1);
  return basename ? SENSITIVE_BASENAME_PATTERNS.some((pattern) => pattern.test(basename)) : false;
}
