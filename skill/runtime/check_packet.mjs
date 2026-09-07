#!/usr/bin/env node
/**
 * Lint a task packet against the handoff template before spending minutes of
 * generation on it. Catches planner mistakes: missing sections, files the
 * executor may change without their full existing code, no modern-practices
 * block, template placeholders left in, retry sections without numbered fixes,
 * and packets that cannot fit num_ctx.
 *
 * Usage: node check_packet.mjs <packet.md> [--json] [--num-ctx N]
 * Exit 0 = ok (warnings allowed), 1 = errors, 2 = usage.
 */
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const CHARS_PER_TOKEN = 3.6;

export const REQUIRED_SECTIONS = [
  "Goal",
  "Files you may change",
  "Conventions",
  "Tests that must pass",
  "Do NOT",
];

/** Split a packet into `## Heading` sections (heading text without markers). */
export function sections(packet) {
  const out = new Map();
  const re = /^## ([^\n]+?)\s*$/gm;
  const heads = [...packet.matchAll(re)];
  for (let i = 0; i < heads.length; i++) {
    const h = heads[i];
    const name = h[1]
      .replace(/\s*\((required|only on retry|required if the file exists)\)\s*$/i, "")
      .trim();
    const start = h.index + h[0].length;
    const end = i + 1 < heads.length ? heads[i + 1].index : packet.length;
    out.set(name, packet.slice(start, end).trim());
  }
  return out;
}

/** Paths listed under "Files you may change", with whether they are declared new. */
export function changeableFiles(section) {
  const files = [];
  for (const line of section.split("\n")) {
    const m = /^\s*[-*]\s+`?([^\s`—-]+(?:\.[A-Za-z0-9]+)?)`?\s*(?:—|-|:)?\s*(.*)$/.exec(line);
    if (!m || !/[./\\]/.test(m[1])) continue;
    const note = (m[2] ?? "").toLowerCase();
    files.push({ path: m[1], isNew: /\b(create|new file|does not exist|new)\b/.test(note) });
  }
  return files;
}

/** `### path` headings under "Existing code" with their fenced block sizes. */
export function existingBlocks(section) {
  const out = new Map();
  const re = /^### ([^\n]+)\n\s*```[^\n]*\n([\s\S]*?)```/gm;
  for (const m of section.matchAll(re)) out.set(m[1].trim().replace(/^`|`$/g, ""), m[2].length);
  return out;
}

export function estimateTokens(text) {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Pure linter. Returns { errors: string[], warnings: string[], info: {...} }.
 * Errors mean the packet should not be sent; warnings are judgment calls.
 */
export function lintPacket(packet, opts = {}) {
  const numCtx = opts.numCtx ?? 16384;
  const systemTokens = opts.systemTokens ?? 350;
  const errors = [];
  const warnings = [];
  const sec = sections(packet);

  if (!/^# Task:/m.test(packet)) warnings.push('Missing "# Task: <title>" heading.');
  for (const name of REQUIRED_SECTIONS) {
    const body = sec.get(name);
    if (body === undefined) errors.push(`Missing section "## ${name}".`);
    else if (body.length === 0) errors.push(`Section "## ${name}" is empty.`);
  }

  const placeholders = packet.match(/<[a-z0-9][^<>\n]{3,80}>/gi) ?? [];
  const realPlaceholders = placeholders.filter(
    (p) => !/^<\/?[a-z]+>$/i.test(p) && !/^<[a-z]+ [a-z-]+=/.test(p),
  );
  if (realPlaceholders.length > 0) {
    errors.push(
      `Template placeholders left in: ${[...new Set(realPlaceholders)].slice(0, 4).join(", ")}${realPlaceholders.length > 4 ? ", …" : ""}.`,
    );
  }

  const conv = sec.get("Conventions") ?? "";
  if (conv && !/modern practices/i.test(conv))
    errors.push('Conventions has no "Modern practices" block (copy it from modern-practices.md).');
  else if (conv && conv.split("\n").filter((l) => /^\s{2,}[-*]\s/.test(l)).length < 2)
    warnings.push(
      "Modern practices block has fewer than two bullets; small models need concrete rules.",
    );
  if (conv && !/language\/version|language:|version:/i.test(conv))
    warnings.push('Conventions does not state "Language/version".');

  const tests = sec.get("Tests that must pass") ?? "";
  if (tests && !/^Command:\s*`[^`]+`/m.test(tests))
    errors.push('Tests section has no "Command: `…`" line.');
  if (tests && !/```/.test(tests)) errors.push("Tests section has no fenced test code.");

  const files = changeableFiles(sec.get("Files you may change") ?? "");
  if (sec.has("Files you may change") && files.length === 0)
    errors.push('"Files you may change" lists no file paths (use "- path — what changes").');
  if (files.length > 3)
    warnings.push(
      `${files.length} files in one packet; the template says one file or one tightly scoped change per packet.`,
    );

  const existing = existingBlocks(sec.get("Existing code") ?? "");
  for (const f of files) {
    if (f.isNew) continue;
    const size = existing.get(f.path);
    if (size === undefined)
      errors.push(
        `"${f.path}" may be changed but its existing code is not pasted under "## Existing code" (### ${f.path}). The executor returns whole files; missing code is deleted. Mark it "— create this file" if it is new.`,
      );
    else if (size < 20)
      warnings.push(`Existing code for "${f.path}" is only ${size} characters; is it complete?`);
  }
  const existingSec = sec.get("Existing code") ?? "";
  if (/\.\.\.\s*$|\/\/ ?\.\.\.|# ?\.\.\.|\/\* ?\.\.\. ?\*\//m.test(existingSec))
    warnings.push(
      'Existing code seems to contain an ellipsis ("...") — excerpting a file the executor must return in full deletes the rest.',
    );

  const donts = sec.get("Do NOT") ?? "";
  if (donts && donts.split("\n").filter((l) => /^\s*[-*]\s/.test(l)).length < 2)
    warnings.push(
      '"Do NOT" has fewer than two bullets; concrete prohibitions work best for small models.',
    );

  const retry = sec.get("Previous attempt failed");
  if (retry !== undefined) {
    if (!/^\s*1\.\s/m.test(retry))
      errors.push(
        '"Previous attempt failed" has no numbered "fix exactly these" list; raw test output alone tends to return the file unchanged.',
      );
    if (retry.length > 4000)
      warnings.push("Retry section is long; trim the test output to the failing assertion.");
  }

  const promptTokens = estimateTokens(packet) + systemTokens;
  let outChars = 0;
  for (const s of existing.values()) outChars += s;
  const expectedOutput = outChars > 0 ? Math.ceil((outChars / CHARS_PER_TOKEN) * 1.2) : 1500;
  const total = promptTokens + expectedOutput;
  if (total > numCtx)
    errors.push(
      `Estimated ${promptTokens} prompt + ${expectedOutput} output = ${total} tokens exceeds num_ctx ${numCtx}; split the packet.`,
    );
  else if (total > numCtx * 0.85)
    warnings.push(
      `Estimated ${total} tokens is ${Math.round((total / numCtx) * 100)}% of num_ctx ${numCtx}.`,
    );
  const testShare = tests.length / Math.max(1, packet.length);
  if (testShare > 0.45)
    warnings.push(
      `Tests are ${Math.round(testShare * 100)}% of the packet; excerpt them (the executor never edits tests).`,
    );

  return {
    errors,
    warnings,
    info: {
      promptTokens,
      expectedOutput,
      total,
      numCtx,
      files: files.map((f) => f.path),
      existing: [...existing.keys()],
    },
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const json = argv.includes("--json");
  const file = argv.find((a) => !a.startsWith("--") && a !== argv[argv.indexOf("--num-ctx") + 1]);
  if (!file) {
    console.error("usage: check_packet.mjs <packet.md> [--json] [--num-ctx N]");
    return 2;
  }
  let numCtx = Number(argv[argv.indexOf("--num-ctx") + 1]);
  if (!Number.isFinite(numCtx) || argv.indexOf("--num-ctx") < 0) {
    try {
      numCtx = JSON.parse(await readFile(join(here, "config.json"), "utf8")).num_ctx ?? 16384;
    } catch {
      numCtx = 16384;
    }
  }
  const packet = await readFile(resolve(file), "utf8");
  const result = lintPacket(packet, { numCtx });
  if (json) console.log(JSON.stringify({ ok: result.errors.length === 0, ...result }));
  else {
    for (const e of result.errors) console.log(`ERROR: ${e}`);
    for (const w of result.warnings) console.log(`warn:  ${w}`);
    console.log(
      `${result.errors.length === 0 ? "OK" : "NOT OK"}: ${result.errors.length} error(s), ${result.warnings.length} warning(s); ~${result.info.total} of ${numCtx} tokens.`,
    );
  }
  return result.errors.length === 0 ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(await main());
}
