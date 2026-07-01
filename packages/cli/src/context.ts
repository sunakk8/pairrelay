import { readdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { SessionContext } from "@pairrelay/shared";

const execFileAsync = promisify(execFile);
const MAX_FILES = 30;

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd });
  return stdout.trim();
}

async function listTrackedFiles(repoRoot: string): Promise<string[]> {
  try {
    const output = await git(["ls-files", "--cached", "--others", "--exclude-standard"], repoRoot);
    if (!output) {
      return [];
    }
    return output
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .slice(0, MAX_FILES);
  } catch {
    return [];
  }
}

async function listRecentFiles(repoRoot: string): Promise<string[]> {
  try {
    const entries = await readdir(repoRoot, { withFileTypes: true });
    return entries
      .filter((e) => e.isFile())
      .map((e) => e.name)
      .slice(0, MAX_FILES);
  } catch {
    return [];
  }
}

export async function detectRepoContext(cwd = process.cwd()): Promise<SessionContext> {
  try {
    const [repoRoot, branch] = await Promise.all([
      git(["rev-parse", "--show-toplevel"], cwd),
      git(["rev-parse", "--abbrev-ref", "HEAD"], cwd),
    ]);
    const files = await listTrackedFiles(repoRoot);
    const fallbackFiles = files.length > 0 ? files : await listRecentFiles(cwd);
    return {
      repo: repoRoot.split(/[/\\]/).pop() ?? repoRoot,
      branch,
      files: fallbackFiles,
    };
  } catch {
    return { repo: "", branch: "", files: [] };
  }
}
