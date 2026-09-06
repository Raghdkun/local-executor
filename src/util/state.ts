import { join } from "node:path";
import type { AgentId } from "../agents/types.js";
import { home, readJsonOr, writeJson } from "./fs.js";

/** Where lex keeps its own bookkeeping. Not an agent directory. */
export function lexHome(): string {
  return process.env.LEX_HOME ?? join(home(), ".local-executor");
}

export function manifestPath(): string {
  return join(lexHome(), "manifest.json");
}

export function cacheDir(): string {
  return join(lexHome(), "cache");
}

export interface InstallRecord {
  agent: AgentId;
  scope: "user" | "project";
  /** Directory that holds core/ and runtime/ for this install. */
  root: string;
  /** Absolute path to the config.json this install reads. */
  configPath: string;
  /** Files and directories we created and own outright (safe to delete). */
  owned: string[];
  /** Shared files we appended a marker block to (must be edited, not deleted). */
  marked: string[];
  installedAt: string;
  version: string;
}

export interface Manifest {
  schema: 1;
  model?: string;
  installs: InstallRecord[];
  updatedAt: string;
}

export const emptyManifest = (): Manifest => ({
  schema: 1,
  installs: [],
  updatedAt: new Date(0).toISOString(),
});

export async function readManifest(): Promise<Manifest> {
  const m = await readJsonOr<Manifest>(manifestPath(), emptyManifest());
  if (!Array.isArray(m.installs)) m.installs = [];
  return m;
}

export async function writeManifest(m: Manifest): Promise<void> {
  m.updatedAt = new Date().toISOString();
  await writeJson(manifestPath(), m);
}

/**
 * Identity of an install. Project-level installs for Codex/Cursor/Windsurf share
 * the user-level root (they only add a rule file or an AGENTS.md block), so the
 * root alone is not unique; the first owned/marked path disambiguates them and
 * keeps installs in different repos apart.
 */
export function installKey(
  rec: Pick<InstallRecord, "agent" | "scope" | "root" | "owned" | "marked">,
): string {
  const anchor = rec.scope === "project" ? (rec.owned[0] ?? rec.marked[0] ?? "") : "";
  return `${rec.agent}|${rec.scope}|${rec.root}|${anchor}`;
}

/** Replace any existing record with the same identity, then append. */
export function upsertInstall(m: Manifest, rec: InstallRecord): Manifest {
  const key = installKey(rec);
  const rest = m.installs.filter((r) => installKey(r) !== key);
  return { ...m, installs: [...rest, rec] };
}
