import { detectHardware } from "../hardware/detect.js";
import { lastVerified } from "../models/catalog.js";
import { buildRecommendation } from "../models/recommend.js";
import { hardwareRows } from "../steps/hardware.js";
import * as log from "../util/log.js";

export async function runModels(opts: { json: boolean; all: boolean }): Promise<number> {
  log.configureUi({ json: opts.json });
  const hw = await detectHardware();
  const report = buildRecommendation(hw, { includeAll: opts.all });
  if (opts.json) {
    process.stdout.write(
      `${JSON.stringify({ hardware: hw, effectiveMemory: report.effectiveMemory, tier: report.tier.label, adjustments: report.adjustments, models: report.list.map(({ model: _m, ...r }) => r), lastVerified }, null, 2)}\n`,
    );
    return 0;
  }
  log.intro("lex models");
  log.table(hardwareRows(hw));
  log.info(
    `Effective memory: ${log.pc.bold(`${report.effectiveMemory.gb} GB`)} (${report.effectiveMemory.rule}) → tier ${report.tier.label}`,
  );
  for (const a of report.adjustments) log.warn(a);
  const rows: [string, string][] = report.list.map((r) => {
    const flags = [
      !r.fitsDisk ? log.pc.yellow("needs disk") : "",
      !r.fitsMemory ? log.pc.yellow("may swap") : "",
    ]
      .filter(Boolean)
      .join(" ");
    return [
      `${r.recommended ? "★ " : "  "}${r.tag}`,
      `~${String(r.sizeGB).padStart(4)} GB  ${r.reason}${flags ? `  [${flags}]` : ""}`,
    ];
  });
  log.table(rows);
  log.outro(
    `Catalog last verified against ollama.com on ${lastVerified}. Nothing was installed.${opts.all ? "" : " Use --all to include models that do not fit."}`,
  );
  return 0;
}
