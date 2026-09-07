import { join } from "node:path";
import { run } from "../util/exec.js";
import * as log from "../util/log.js";
import { skillSourceDir } from "../util/pkg.js";
import { readManifest } from "../util/state.js";

/**
 * `lex packet check <file>` runs the same linter the executor runs before
 * sending (runtime/check_packet.mjs), so planners can validate a packet
 * without spending minutes of generation. Uses the num_ctx of the first
 * installed config when available.
 */
export async function runPacketCheck(
  file: string,
  opts: { json: boolean; numCtx?: number },
): Promise<number> {
  log.configureUi({ json: opts.json });
  const script = join(skillSourceDir(), "runtime", "check_packet.mjs");
  const args = [script, file];
  let numCtx = opts.numCtx;
  if (!numCtx) {
    const manifest = await readManifest();
    const first = manifest.installs.find((i) => i.owned.includes(i.root));
    if (first) {
      try {
        const cfg = JSON.parse(
          await (await import("node:fs/promises")).readFile(first.configPath, "utf8"),
        ) as { num_ctx?: number };
        numCtx = cfg.num_ctx;
      } catch {
        // fall back to the runtime default
      }
    }
  }
  if (numCtx) args.push("--num-ctx", String(numCtx));
  if (opts.json) args.push("--json");
  const r = await run(process.execPath, args, { inherit: true });
  return r.exitCode ?? 1;
}
