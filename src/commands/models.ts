import { join } from "node:path";
import { detectHardware } from "../hardware/detect.js";
import { lastVerified } from "../models/catalog.js";
import { buildRecommendation } from "../models/recommend.js";
import { refreshCatalog, summarizeRefresh } from "./../models/refresh.js";
import { hardwareRows } from "../steps/hardware.js";
import { contractTilde, writeJson } from "../util/fs.js";
import * as log from "../util/log.js";
import { cacheDir } from "../util/state.js";

export function refreshStampPath(): string {
  return join(cacheDir(), "refresh.json");
}

export async function runRefresh(opts: { json: boolean }): Promise<number> {
  log.configureUi({ json: opts.json });
  const sp = log.spinner();
  sp.start("Checking ollama.com for the catalog families and the newest library entries…");
  const report = await refreshCatalog((i, o) => fetch(i, o));
  sp.stop("Checked.");
  await writeJson(refreshStampPath(), {
    checkedAt: report.checkedAt,
    summary: summarizeRefresh(report),
  }).catch(() => undefined);
  if (opts.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return report.errors.length === report.families.length + 1 ? 2 : 0;
  }
  log.intro("lex models --refresh");
  for (const line of summarizeRefresh(report)) {
    if (/no longer|Could not/.test(line)) log.warn(line);
    else if (/newer|Newest|now ~/.test(line)) log.info(line);
    else log.message(line);
  }
  log.note(
    "Nothing was pulled or changed. To switch: `lex switch <tag>` (pulls if needed, updates every config).\nTo add a model to the catalog, see README → Contributing.",
    "Next",
  );
  log.outro(`Result cached in ${contractTilde(refreshStampPath())}.`);
  return 0;
}

export async function runModels(opts: {
  json: boolean;
  all: boolean;
  refresh?: boolean;
}): Promise<number> {
  if (opts.refresh) return runRefresh({ json: opts.json });
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
