import { join } from "node:path";
import type { AgentId } from "./types.js";

/**
 * Where each agent's install goes. Pure: given a home directory and an optional
 * project root, it returns absolute paths and never touches the disk.
 */

export type InstallScope = "user" | "project";

export interface AdapterFile {
  /** Path relative to `skill/adapters/` in the package. */
  source: string;
  /** Absolute destination. */
  dest: string;
}

export interface MarkedFile {
  /** Path relative to `skill/adapters/` of the block body template. */
  source: string;
  /** Absolute path of the shared file we append a marker block to. */
  dest: string;
}

export interface InstallTarget {
  agent: AgentId;
  scope: InstallScope;
  /** Directory that receives `core/` and `runtime/`. */
  root: string;
  /** Files copied verbatim-with-templating next to (or pointing at) root. */
  adapters: AdapterFile[];
  /** Shared files that get a marker-delimited block instead of being overwritten. */
  marked: MarkedFile[];
  /** Optional extras that only apply when a directory already exists. */
  optional: { ifDirExists: string; adapter: AdapterFile }[];
  /** One-line explanation printed to the user. */
  summary: string;
}

export interface PathContext {
  home: string;
  /** Repo root when running inside a project, else null. */
  projectRoot: string | null;
}

export const SKILL_DIR_NAME = "local-executor-pipeline";

export function userTarget(agent: AgentId, ctx: PathContext): InstallTarget {
  const h = ctx.home;
  switch (agent) {
    case "claude": {
      const root = join(h, ".claude", "skills", SKILL_DIR_NAME);
      return {
        agent,
        scope: "user",
        root,
        adapters: [{ source: "claude-code/SKILL.md", dest: join(root, "SKILL.md") }],
        marked: [],
        optional: [],
        summary: "Claude Code user-level skill",
      };
    }
    case "codex": {
      const root = join(h, ".codex", "local-executor");
      return {
        agent,
        scope: "user",
        root,
        adapters: [],
        marked: [{ source: "codex/AGENTS.block.md", dest: join(h, ".codex", "AGENTS.md") }],
        optional: [
          {
            ifDirExists: join(h, ".codex", "skills"),
            adapter: {
              source: "codex/SKILL.md",
              dest: join(h, ".codex", "skills", SKILL_DIR_NAME, "SKILL.md"),
            },
          },
        ],
        summary: "Codex CLI global instructions block + scripts",
      };
    }
    case "cursor": {
      const root = join(h, ".cursor", "local-executor");
      return {
        agent,
        scope: "user",
        root,
        adapters: [],
        marked: [],
        optional: [],
        summary: "Cursor global scripts copy (rules are per project)",
      };
    }
    case "windsurf": {
      const root = join(h, ".codeium", "windsurf", "local-executor");
      return {
        agent,
        scope: "user",
        root,
        adapters: [],
        marked: [],
        optional: [],
        summary: "Windsurf global scripts copy (rules are per project)",
      };
    }
  }
}

/**
 * Project-level pieces. For Claude Code this is a full second copy of the skill
 * inside the repo. For Cursor/Windsurf it is the rule file that points at the
 * user-level scripts (so the repo does not carry a copy of the runtime).
 */
export function projectTarget(agent: AgentId, ctx: PathContext): InstallTarget | null {
  if (!ctx.projectRoot) return null;
  const p = ctx.projectRoot;
  const user = userTarget(agent, ctx);
  switch (agent) {
    case "claude": {
      const root = join(p, ".claude", "skills", SKILL_DIR_NAME);
      return {
        agent,
        scope: "project",
        root,
        adapters: [{ source: "claude-code/SKILL.md", dest: join(root, "SKILL.md") }],
        marked: [],
        optional: [],
        summary: "Claude Code project-level skill",
      };
    }
    case "codex":
      return {
        agent,
        scope: "project",
        root: user.root,
        adapters: [],
        marked: [{ source: "codex/AGENTS.block.md", dest: join(p, "AGENTS.md") }],
        optional: [],
        summary: "Codex block in the project's AGENTS.md",
      };
    case "cursor":
      return {
        agent,
        scope: "project",
        root: user.root,
        adapters: [
          {
            source: "cursor/local-executor.mdc",
            dest: join(p, ".cursor", "rules", "local-executor.mdc"),
          },
        ],
        marked: [],
        optional: [],
        summary: "Cursor project rule",
      };
    case "windsurf":
      return {
        agent,
        scope: "project",
        root: user.root,
        adapters: [
          {
            source: "windsurf/local-executor.md",
            dest: join(p, ".windsurf", "rules", "local-executor.md"),
          },
        ],
        marked: [],
        optional: [],
        summary: "Windsurf project rule",
      };
  }
}

export interface ResolveOptions {
  /** Whether to include project-level pieces when a project root exists. */
  project: boolean;
}

/** All targets for a set of agents. User-level always; project-level when asked and possible. */
export function resolveTargets(
  agents: AgentId[],
  ctx: PathContext,
  opts: ResolveOptions,
): InstallTarget[] {
  const out: InstallTarget[] = [];
  for (const a of agents) {
    out.push(userTarget(a, ctx));
    if (opts.project) {
      const pt = projectTarget(a, ctx);
      if (pt) out.push(pt);
    }
  }
  return out;
}

export function configPathFor(root: string): string {
  return join(root, "runtime", "config.json");
}
