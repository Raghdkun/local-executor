import { detectAgents } from "../agents/detect.js";
import { type AgentId, agentNames, allAgents } from "../agents/types.js";
import { which } from "../util/exec.js";
import { exists, findGitRoot, home } from "../util/fs.js";
import * as log from "../util/log.js";
import type { RunContext } from "./context.js";

export async function stepAgents(ctx: RunContext): Promise<void> {
  log.header(
    "4/6",
    "Agents",
    "Which AI coding agents should learn the pipeline. Detected ones are preselected.",
  );
  const platform =
    process.platform === "darwin" || process.platform === "win32" ? process.platform : "linux";
  ctx.detections = await detectAgents({ which, exists, home: home(), platform, env: process.env });

  const detected = ctx.detections.filter((d) => d.detected);
  for (const d of ctx.detections) {
    if (d.detected) log.success(`${d.name}: ${d.evidence.join(", ")}`);
    else log.message(log.pc.dim(`${d.name}: not detected`));
  }

  if (ctx.opts.agents && ctx.opts.agents.length > 0) {
    ctx.agents = ctx.opts.agents;
  } else {
    const initial = detected.map((d) => d.id);
    ctx.agents = await log.multiselect<AgentId>(
      "Install the skill for",
      allAgents.map((id) => ({
        value: id,
        label: agentNames[id],
        hint: ctx.detections.find((d) => d.id === id)?.detected
          ? "detected"
          : "not detected — install anyway",
      })),
      initial,
      false,
    );
  }

  if (ctx.agents.length === 0) {
    log.warn(
      "No agents selected. Nothing will be installed; run `lex init --agents claude,codex` later.",
    );
  }
  const notDetected = ctx.agents.filter((a) => !ctx.detections.find((d) => d.id === a)?.detected);
  if (notDetected.length > 0) {
    log.warn(
      `Installing for agents that are not detected yet: ${notDetected.map((a) => agentNames[a]).join(", ")}. The files will be ready when you install them.`,
    );
  }

  ctx.projectRoot = await findGitRoot(ctx.cwd);
  const needsProject = ctx.agents.some((a) => a === "cursor" || a === "windsurf");
  if (ctx.opts.project !== undefined) {
    ctx.installProject = ctx.opts.project && ctx.projectRoot !== null;
    if (ctx.opts.project && !ctx.projectRoot) {
      log.warn(
        "--project given but the current directory is not inside a git repository; skipping project-level files.",
      );
    }
  } else if (ctx.projectRoot && ctx.agents.length > 0) {
    ctx.installProject = await log.confirm(
      `Also install project-level files into ${ctx.projectRoot}? (${needsProject ? "required for Cursor/Windsurf rules; " : ""}Claude gets a repo-local copy of the skill)`,
      needsProject,
    );
  } else {
    ctx.installProject = false;
    if (needsProject) {
      log.warn(
        "Cursor/Windsurf rules are per project. Run `lex init --agents cursor --project` inside a repository to add the rule file there.",
      );
    }
  }
}
