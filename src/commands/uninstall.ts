import { uninstallRecord } from "../agents/install.js";
import { type AgentId, agentNames } from "../agents/types.js";
import { contractTilde } from "../util/fs.js";
import * as log from "../util/log.js";
import { readManifest, writeManifest } from "../util/state.js";

export async function runUninstall(opts: {
  yes: boolean;
  json: boolean;
  agents?: AgentId[];
}): Promise<number> {
  log.configureUi({ yes: opts.yes, json: opts.json });
  const manifest = await readManifest();
  const targets = manifest.installs.filter((r) => !opts.agents || opts.agents.includes(r.agent));
  log.intro("lex uninstall");
  if (targets.length === 0) {
    log.info("Nothing recorded to uninstall.");
    if (opts.json) process.stdout.write(`${JSON.stringify({ ok: true, removed: [] })}\n`);
    return 0;
  }
  const preview = targets
    .map((r) => {
      const items = [
        ...r.owned.map((p) => `delete  ${contractTilde(p)}`),
        ...r.marked.map((p) => `unmark  ${contractTilde(p)} (block only)`),
      ];
      return `${agentNames[r.agent]} (${r.scope})\n  ${items.join("\n  ")}`;
    })
    .join("\n");
  log.note(preview, "This will");
  if (!(await log.confirm("Proceed?", true))) return 130;

  const removed: string[] = [];
  for (const rec of targets) {
    const actions = await uninstallRecord(rec);
    removed.push(...actions);
    for (const a of actions) log.success(a.replace(process.env.HOME ?? "", "~"));
  }
  manifest.installs = manifest.installs.filter((r) => !targets.includes(r));
  await writeManifest(manifest);
  if (opts.json) process.stdout.write(`${JSON.stringify({ ok: true, removed })}\n`);
  else log.outro(`Removed ${targets.length} install(s). Ollama and pulled models were left alone.`);
  return 0;
}
