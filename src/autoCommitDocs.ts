import { spawnSync } from "node:child_process";
import path from "node:path";
import type { CodexProConfig } from "./config.js";
import type { Workspace } from "./guard.js";
import { PathGuard } from "./guard.js";
import { redactSensitiveText } from "./redact.js";

type GitCommandResult = {
  ok: boolean;
  stdout: string;
  stderr: string;
  status: number | null;
  error?: string;
};

type GitStatusEntry = {
  status: string;
  paths: string[];
};

export type AutoCommitSnapshot = {
  enabled: boolean;
  ok: boolean;
  dirtyPaths: Set<string>;
  reason?: string;
};

export type AutoCommitResult = {
  enabled: boolean;
  status: "disabled" | "skipped" | "pending" | "committed" | "error";
  files: string[];
  commit?: string;
  message?: string;
  reason?: string;
  error?: string;
};

type PendingBatch = {
  workspace: Workspace;
  files: Set<string>;
  timer?: ReturnType<typeof setTimeout>;
  updatedAt: string;
};

function runGit(workspace: Workspace, args: string[], maxOutputBytes: number): GitCommandResult {
  const result = spawnSync("git", args, {
    cwd: workspace.root,
    encoding: "utf8",
    maxBuffer: maxOutputBytes,
    env: { ...process.env, NO_COLOR: "1" }
  });
  if (result.error) {
    return { ok: false, stdout: "", stderr: "", status: null, error: result.error.message };
  }
  return {
    ok: result.status === 0,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    status: result.status
  };
}

function gitError(result: GitCommandResult): string {
  return redactSensitiveText(result.error || result.stderr.trim() || result.stdout.trim() || `git exited with status ${result.status}`);
}

function normalizeGitPath(raw: string): string {
  return raw.replaceAll("\\", "/").replace(/^\.\//, "");
}

function parseStatusPorcelainZ(output: string): GitStatusEntry[] {
  const parts = output.split("\0").filter(Boolean);
  const entries: GitStatusEntry[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const entry = parts[index];
    if (entry.length < 4) continue;
    const status = entry.slice(0, 2);
    const firstPath = normalizeGitPath(entry.slice(3));
    const paths = [firstPath];
    if (status.includes("R") || status.includes("C")) {
      const secondPath = parts[index + 1];
      if (secondPath) {
        paths.push(normalizeGitPath(secondPath));
        index += 1;
      }
    }
    entries.push({ status, paths: paths.filter(Boolean) });
  }
  return entries;
}

function dirtyPathsFromStatus(output: string): Set<string> {
  const paths = new Set<string>();
  for (const entry of parseStatusPorcelainZ(output)) {
    for (const relPath of entry.paths) paths.add(relPath);
  }
  return paths;
}

function isContextPath(config: CodexProConfig, relPath: string): boolean {
  const contextDir = normalizeGitPath(config.contextDir).replace(/\/+$/, "");
  return relPath === contextDir || relPath.startsWith(`${contextDir}/`);
}

function isDocumentPath(config: CodexProConfig, relPath: string): boolean {
  if (!relPath || relPath === "." || relPath.startsWith("../") || path.posix.isAbsolute(relPath)) return false;
  if (isContextPath(config, relPath)) return false;
  const ext = path.posix.extname(relPath).toLowerCase();
  return Boolean(ext && config.autoCommitDocExtensions.includes(ext));
}

function eligibleAutoCommitPath(config: CodexProConfig, guard: PathGuard, workspace: Workspace, rawPath: string): string | undefined {
  try {
    const resolved = guard.resolve(workspace, rawPath, { forWrite: true });
    return isDocumentPath(config, resolved.relPath) ? resolved.relPath : undefined;
  } catch {
    return undefined;
  }
}

function eligibleAutoCommitPaths(config: CodexProConfig, guard: PathGuard, workspace: Workspace, candidates: string[]): string[] {
  const paths = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate?.trim()) continue;
    const eligible = eligibleAutoCommitPath(config, guard, workspace, candidate);
    if (eligible) paths.add(eligible);
  }
  return [...paths].sort();
}

function autoCommitMessage(files: string[]): string {
  if (files.length === 1) return `docs: update ${cleanMessagePart(path.posix.basename(files[0]))}`;
  return `docs: auto-commit ${files.length} document files`;
}

function cleanMessagePart(value: string): string {
  return value.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "document";
}

export function captureAutoCommitSnapshot(config: CodexProConfig, workspace: Workspace): AutoCommitSnapshot {
  if (!config.autoCommitDocs) {
    return { enabled: false, ok: false, dirtyPaths: new Set(), reason: "CODEXPRO_AUTO_COMMIT_DOCS is disabled." };
  }
  const status = runGit(workspace, ["status", "--porcelain=v1", "-z", "--untracked-files=all"], config.maxOutputBytes);
  if (!status.ok) {
    return {
      enabled: true,
      ok: false,
      dirtyPaths: new Set(),
      reason: gitError(status)
    };
  }
  return { enabled: true, ok: true, dirtyPaths: dirtyPathsFromStatus(status.stdout) };
}

function commitDocumentFiles(
  config: CodexProConfig,
  guard: PathGuard,
  workspace: Workspace,
  requestedFiles: string[]
): AutoCommitResult {
  const after = runGit(workspace, ["status", "--porcelain=v1", "-z", "--untracked-files=all"], config.maxOutputBytes);
  if (!after.ok) {
    return { enabled: true, status: "error", files: [], error: gitError(after) };
  }

  const afterDirty = dirtyPathsFromStatus(after.stdout);
  const dirtyRequested = requestedFiles
    .map(normalizeGitPath)
    .filter((relPath) => afterDirty.has(relPath))
  const files = eligibleAutoCommitPaths(config, guard, workspace, dirtyRequested);

  if (!files.length) {
    return { enabled: true, status: "skipped", files: [], reason: "No new document changes from this tool call." };
  }

  const add = runGit(workspace, ["add", "-A", "--", ...files], config.maxOutputBytes);
  if (!add.ok) {
    return { enabled: true, status: "error", files, error: gitError(add) };
  }

  const staged = runGit(workspace, ["diff", "--cached", "--quiet", "--", ...files], config.maxOutputBytes);
  if (staged.ok) {
    return { enabled: true, status: "skipped", files, reason: "Document paths had no staged content after git add." };
  }
  if (staged.status !== 1) {
    return { enabled: true, status: "error", files, error: gitError(staged) };
  }

  const message = autoCommitMessage(files);
  const commit = runGit(workspace, ["commit", "-m", message, "--", ...files], config.maxOutputBytes);
  if (!commit.ok) {
    return { enabled: true, status: "error", files, message, error: gitError(commit) };
  }

  const rev = runGit(workspace, ["rev-parse", "--short", "HEAD"], config.maxOutputBytes);
  return {
    enabled: true,
    status: "committed",
    files,
    message,
    commit: rev.ok ? rev.stdout.trim() : undefined
  };
}

export class AutoCommitBatcher {
  private readonly batches = new Map<string, PendingBatch>();

  constructor(
    private readonly config: CodexProConfig,
    private readonly guard: PathGuard
  ) {}

  queue(
    workspace: Workspace,
    before: AutoCommitSnapshot,
    candidatePaths?: string[],
    options: { includePreexistingDirtyCandidates?: boolean; skipReason?: string } = {}
  ): AutoCommitResult {
    if (!this.config.autoCommitDocs) {
      return { enabled: false, status: "disabled", files: [], reason: "CODEXPRO_AUTO_COMMIT_DOCS is disabled." };
    }
    if (!before.ok) {
      return { enabled: true, status: "skipped", files: [], reason: before.reason || "Could not read git status before the tool call." };
    }
    if (options.skipReason) {
      return { enabled: true, status: "skipped", files: [], reason: options.skipReason };
    }

    const after = runGit(workspace, ["status", "--porcelain=v1", "-z", "--untracked-files=all"], this.config.maxOutputBytes);
    if (!after.ok) {
      return { enabled: true, status: "error", files: [], error: gitError(after) };
    }

    const afterDirty = dirtyPathsFromStatus(after.stdout);
    const candidateSet = candidatePaths ? new Set(candidatePaths.map(normalizeGitPath)) : afterDirty;
    const includePreexistingDirty = Boolean(candidatePaths?.length && options.includePreexistingDirtyCandidates);
    const changedCandidates = [...candidateSet]
      .map(normalizeGitPath)
      .filter((relPath) => afterDirty.has(relPath))
      .filter((relPath) => includePreexistingDirty || !before.dirtyPaths.has(relPath));
    const files = eligibleAutoCommitPaths(this.config, this.guard, workspace, changedCandidates);

    if (!files.length) {
      return { enabled: true, status: "skipped", files: [], reason: "No new document changes from this tool call." };
    }

    const key = workspace.root;
    const batch = this.batches.get(key) ?? {
      workspace,
      files: new Set<string>(),
      updatedAt: new Date().toISOString()
    };
    for (const file of files) batch.files.add(file);
    batch.updatedAt = new Date().toISOString();
    this.batches.set(key, batch);
    this.scheduleFlush(workspace);

    return {
      enabled: true,
      status: "pending",
      files: [...batch.files].sort(),
      reason: `Queued for one batched document commit. It will flush on show_changes or after ${this.config.autoCommitDocsIdleMs} ms of MCP session idle time.`
    };
  }

  flush(workspace: Workspace): AutoCommitResult {
    if (!this.config.autoCommitDocs) {
      return { enabled: false, status: "disabled", files: [], reason: "CODEXPRO_AUTO_COMMIT_DOCS is disabled." };
    }

    const key = workspace.root;
    const batch = this.batches.get(key);
    if (!batch) {
      return { enabled: true, status: "skipped", files: [], reason: "No pending document changes to commit." };
    }

    if (batch.timer) clearTimeout(batch.timer);
    this.batches.delete(key);
    return commitDocumentFiles(this.config, this.guard, workspace, [...batch.files].sort());
  }

  touch(workspace: Workspace): AutoCommitResult {
    const pending = this.pending(workspace);
    if (pending.status === "pending") this.scheduleFlush(workspace);
    return pending;
  }

  pending(workspace: Workspace): AutoCommitResult {
    if (!this.config.autoCommitDocs) {
      return { enabled: false, status: "disabled", files: [], reason: "CODEXPRO_AUTO_COMMIT_DOCS is disabled." };
    }
    const batch = this.batches.get(workspace.root);
    if (!batch) return { enabled: true, status: "skipped", files: [], reason: "No pending document changes to commit." };
    return {
      enabled: true,
      status: "pending",
      files: [...batch.files].sort(),
      reason: `Queued for one batched document commit. Last updated at ${batch.updatedAt}.`
    };
  }

  private scheduleFlush(workspace: Workspace): void {
    const batch = this.batches.get(workspace.root);
    if (!batch) return;
    if (batch.timer) clearTimeout(batch.timer);
    batch.timer = setTimeout(() => {
      const result = this.flush(workspace);
      if (result.status === "error") {
        console.error(`[CodexPro] auto-commit error: ${result.error ?? result.reason ?? "unknown error"}`);
      } else if (result.status === "committed") {
        console.error(`[CodexPro] auto-commit ${result.commit ?? "created"} ${result.files.length} document file(s)`);
      }
    }, this.config.autoCommitDocsIdleMs);
    batch.timer.unref?.();
  }
}

export function autoCommitSummary(result: AutoCommitResult): string {
  if (result.status === "disabled") return "";
  if (result.status === "skipped" && result.reason === "No pending document changes to commit.") return "";
  if (result.status === "pending") {
    return `Auto-commit pending: ${result.files.length} file${result.files.length === 1 ? "" : "s"} queued.\nFiles: ${result.files.join(", ")}\n${result.reason ?? ""}`.trim();
  }
  if (result.status === "committed") {
    return `Auto-commit: ${result.commit ?? "created"} ${result.message ?? ""}\nFiles: ${result.files.join(", ")}`;
  }
  if (result.status === "skipped") {
    return `Auto-commit skipped: ${result.reason ?? "no eligible document changes"}`;
  }
  return `Auto-commit error: ${result.error ?? result.reason ?? "unknown error"}`;
}
