import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  configPathFor,
  projectTarget,
  resolveTargets,
  userTarget,
} from "../../src/agents/paths.js";

const home = "/home/u";
const proj = "/home/u/repo";

describe("userTarget", () => {
  it("Claude Code → ~/.claude/skills/local-executor-pipeline with SKILL.md", () => {
    const t = userTarget("claude", { home, projectRoot: null });
    expect(t.root).toBe(join(home, ".claude", "skills", "local-executor-pipeline"));
    expect(t.adapters[0]?.dest).toBe(join(t.root, "SKILL.md"));
    expect(t.marked).toEqual([]);
  });

  it("Codex → ~/.codex/local-executor + AGENTS.md block + optional skills SKILL.md", () => {
    const t = userTarget("codex", { home, projectRoot: null });
    expect(t.root).toBe(join(home, ".codex", "local-executor"));
    expect(t.marked[0]?.dest).toBe(join(home, ".codex", "AGENTS.md"));
    expect(t.optional[0]?.ifDirExists).toBe(join(home, ".codex", "skills"));
    expect(t.optional[0]?.adapter.dest).toBe(
      join(home, ".codex", "skills", "local-executor-pipeline", "SKILL.md"),
    );
  });

  it("Cursor / Windsurf → global scripts only at user level", () => {
    expect(userTarget("cursor", { home, projectRoot: null }).root).toBe(
      join(home, ".cursor", "local-executor"),
    );
    expect(userTarget("windsurf", { home, projectRoot: null }).root).toBe(
      join(home, ".codeium", "windsurf", "local-executor"),
    );
    expect(userTarget("cursor", { home, projectRoot: null }).adapters).toEqual([]);
  });
});

describe("projectTarget", () => {
  it("returns null without a project root", () => {
    expect(projectTarget("claude", { home, projectRoot: null })).toBeNull();
  });

  it("Claude project copy lives in ./.claude/skills", () => {
    const t = projectTarget("claude", { home, projectRoot: proj });
    expect(t?.root).toBe(join(proj, ".claude", "skills", "local-executor-pipeline"));
    expect(t?.scope).toBe("project");
  });

  it("Cursor / Windsurf project rules point at the user-level root", () => {
    const c = projectTarget("cursor", { home, projectRoot: proj });
    expect(c?.root).toBe(join(home, ".cursor", "local-executor"));
    expect(c?.adapters[0]?.dest).toBe(join(proj, ".cursor", "rules", "local-executor.mdc"));
    const w = projectTarget("windsurf", { home, projectRoot: proj });
    expect(w?.adapters[0]?.dest).toBe(join(proj, ".windsurf", "rules", "local-executor.md"));
  });

  it("Codex project → block in ./AGENTS.md", () => {
    const t = projectTarget("codex", { home, projectRoot: proj });
    expect(t?.marked[0]?.dest).toBe(join(proj, "AGENTS.md"));
  });
});

describe("resolveTargets", () => {
  it("user-level only when project is false", () => {
    const ts = resolveTargets(
      ["claude", "cursor"],
      { home, projectRoot: proj },
      { project: false },
    );
    expect(ts.map((t) => `${t.agent}:${t.scope}`)).toEqual(["claude:user", "cursor:user"]);
  });
  it("adds project pieces when asked and a project exists", () => {
    const ts = resolveTargets(["claude", "cursor"], { home, projectRoot: proj }, { project: true });
    expect(ts.map((t) => `${t.agent}:${t.scope}`)).toEqual([
      "claude:user",
      "claude:project",
      "cursor:user",
      "cursor:project",
    ]);
  });
  it("configPathFor points at runtime/config.json", () => {
    expect(configPathFor("/r")).toBe(join("/r", "runtime", "config.json"));
  });
});
