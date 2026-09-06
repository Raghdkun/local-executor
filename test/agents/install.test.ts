import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import {
  installTarget,
  renderTemplate,
  templateVars,
  uninstallRecord,
  updateConfigModel,
} from "../../src/agents/install.js";
import { projectTarget, userTarget } from "../../src/agents/paths.js";
import { exists } from "../../src/util/fs.js";
import { skillSourceDir } from "../../src/util/pkg.js";

let home: string;
let proj: string;
const skillSource = skillSourceDir();

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "lex-home-"));
  proj = await mkdtemp(join(tmpdir(), "lex-proj-"));
});

const base = () => ({
  skillSource,
  model: "qwen3.5:9b",
  ollamaUrl: "http://localhost:11434",
  version: "0.1.0-test",
  modelsDoc: "# models\n",
});

describe("templates", () => {
  it("renders placeholders with posix paths and leaves unknown keys", () => {
    const vars = templateVars("C:\\Users\\x\\.claude\\skills\\lex", "m:1", "1.2.3");
    expect(vars.LEX_CORE).toBe("C:/Users/x/.claude/skills/lex/core");
    expect(renderTemplate("a {{LEX_MODEL}} b {{LEX_UNKNOWN}}", vars)).toBe(
      "a m:1 b {{LEX_UNKNOWN}}",
    );
  });
});

describe("installTarget: Claude Code", () => {
  it("copies core+runtime, renders SKILL.md, writes config, and is idempotent", async () => {
    const target = userTarget("claude", { home, projectRoot: null });
    const first = await installTarget({ ...base(), target });
    const skill = await readFile(join(target.root, "SKILL.md"), "utf8");
    expect(skill).toContain(`${target.root.split("\\").join("/")}/core/PIPELINE.md`);
    expect(skill).not.toContain("{{LEX_");
    const pipeline = await readFile(join(target.root, "core", "PIPELINE.md"), "utf8");
    expect(pipeline).toContain("qwen3.5:9b");
    expect(pipeline).not.toContain("{{LEX_");
    expect(await exists(join(target.root, "core", "models.md"))).toBe(true);
    expect(await exists(join(target.root, "core", "executor-system-prompt.md"))).toBe(true);
    expect(await exists(join(target.root, "runtime", "run_executor.mjs"))).toBe(true);
    const cfg = JSON.parse(await readFile(first.record.configPath, "utf8"));
    expect(cfg.model).toBe("qwen3.5:9b");
    expect(cfg.num_ctx).toBe(16384);
    expect(first.record.owned).toEqual([target.root]);
    expect(first.actions[0]).toMatch(/^Created/);

    // User tweak survives re-install; model is updated.
    await writeFile(first.record.configPath, JSON.stringify({ ...cfg, num_ctx: 8192 }));
    const second = await installTarget({ ...base(), target, model: "qwen3.5:4b" });
    const cfg2 = JSON.parse(await readFile(second.record.configPath, "utf8"));
    expect(cfg2).toMatchObject({ model: "qwen3.5:4b", num_ctx: 8192 });
  });

  it("uninstall removes the owned root", async () => {
    const target = userTarget("claude", { home, projectRoot: null });
    const { record } = await installTarget({ ...base(), target });
    const actions = await uninstallRecord(record);
    expect(actions[0]).toMatch(/^Removed/);
    expect(await exists(target.root)).toBe(false);
  });
});

describe("installTarget: Codex", () => {
  it("appends a marker block to AGENTS.md without clobbering, and removes it on uninstall", async () => {
    await mkdir(join(home, ".codex", "skills"), { recursive: true });
    const agentsPath = join(home, ".codex", "AGENTS.md");
    await writeFile(agentsPath, "# My global rules\n\nBe nice.\n");
    const target = userTarget("codex", { home, projectRoot: null });
    const { record } = await installTarget({ ...base(), target });

    const agents = await readFile(agentsPath, "utf8");
    expect(agents.startsWith("# My global rules\n\nBe nice.\n")).toBe(true);
    expect(agents).toContain("<!-- lex:start -->");
    expect(agents).toContain("codex exec");
    expect(agents.match(/<!-- lex:start -->/g)).toHaveLength(1);
    expect(record.marked).toEqual([agentsPath]);
    // Optional skills SKILL.md written because ~/.codex/skills exists.
    const skillFile = join(home, ".codex", "skills", "local-executor-pipeline", "SKILL.md");
    expect(await exists(skillFile)).toBe(true);
    expect(record.owned).toContain(join(home, ".codex", "skills", "local-executor-pipeline"));

    // Second install replaces the block, still exactly one.
    await installTarget({ ...base(), target, model: "gemma4:e4b" });
    const again = await readFile(agentsPath, "utf8");
    expect(again.match(/<!-- lex:start -->/g)).toHaveLength(1);
    expect(again).toContain("gemma4:e4b");

    await uninstallRecord(record);
    const after = await readFile(agentsPath, "utf8");
    expect(after).toBe("# My global rules\n\nBe nice.\n");
    expect(await exists(target.root)).toBe(false);
    expect(await exists(skillFile)).toBe(false);
  });

  it("does not write the skills SKILL.md when ~/.codex/skills is absent", async () => {
    const target = userTarget("codex", { home, projectRoot: null });
    await installTarget({ ...base(), target });
    expect(await exists(join(home, ".codex", "skills"))).toBe(false);
  });
});

describe("installTarget: Cursor / Windsurf", () => {
  it("project rule points at the user-level runtime and does not own the root", async () => {
    const userT = userTarget("cursor", { home, projectRoot: proj });
    await installTarget({ ...base(), target: userT });
    const projT = projectTarget("cursor", { home, projectRoot: proj });
    if (!projT) throw new Error("expected project target");
    const { record } = await installTarget({ ...base(), target: projT });
    const rule = await readFile(join(proj, ".cursor", "rules", "local-executor.mdc"), "utf8");
    expect(rule).toContain(`${userT.root.split("\\").join("/")}/runtime/run_executor.mjs`);
    expect(rule.startsWith("---\n")).toBe(true);
    expect(record.owned).toEqual([join(proj, ".cursor", "rules", "local-executor.mdc")]);
    await uninstallRecord(record);
    expect(await exists(join(proj, ".cursor", "rules", "local-executor.mdc"))).toBe(false);
    expect(await exists(userT.root)).toBe(true);
  });

  it("windsurf rule has the trigger frontmatter", async () => {
    const projT = projectTarget("windsurf", { home, projectRoot: proj });
    if (!projT) throw new Error("expected project target");
    await installTarget({ ...base(), target: projT });
    const rule = await readFile(join(proj, ".windsurf", "rules", "local-executor.md"), "utf8");
    expect(rule).toMatch(/^---\ntrigger: model_decision/);
  });
});

describe("updateConfigModel", () => {
  it("updates only the model and returns false for a missing file", async () => {
    const target = userTarget("claude", { home, projectRoot: null });
    const { record } = await installTarget({ ...base(), target });
    expect(await updateConfigModel(record.configPath, "gemma4:26b")).toBe(true);
    expect(JSON.parse(await readFile(record.configPath, "utf8")).model).toBe("gemma4:26b");
    expect(await updateConfigModel(join(home, "nope.json"), "x")).toBe(false);
  });
});
