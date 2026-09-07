#!/usr/bin/env node
/**
 * Turn the auditor's "MISSING TESTS" list into skipped/todo test stubs appended
 * to a test file, so coverage grows with every accepted packet. Stubs carry a
 * "lex:missing-test" marker and are deduplicated by description.
 *
 * Usage: node add_test_stubs.mjs --verdict <audit-reply.md> --into <test file> [--framework auto|node|vitest|jest|pytest|go|rust|dart|generic]
 */
import { readFile, writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const MARKER = "lex:missing-test";

/** Bullet items under "MISSING TESTS:" until the next blank-line-separated heading. */
export function parseMissingTests(verdict) {
  const lines = verdict.split("\n");
  const start = lines.findIndex((l) => /^\s*MISSING TESTS:/.test(l));
  if (start < 0) return [];
  const out = [];
  for (const raw of lines.slice(start + 1)) {
    const l = raw.trim();
    if (l === "") {
      if (out.length > 0) break;
      continue;
    }
    if (!/^[-*]\s/.test(l)) break;
    const item = l.replace(/^[-*]\s*/, "").trim();
    if (item && !/^none\.?$/i.test(item)) out.push(item);
  }
  return out;
}

export function detectFramework(file, content) {
  const ext = extname(file).toLowerCase();
  if (ext === ".py") return "pytest";
  if (ext === ".go") return "go";
  if (ext === ".rs") return "rust";
  if (ext === ".dart") return "dart";
  if (/from ["']vitest["']/.test(content)) return "vitest";
  if (/from ["']node:test["']/.test(content)) return "node";
  if (/\bdescribe\(|\bit\(|\btest\(/.test(content)) return "jest";
  if ([".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx"].includes(ext)) return "node";
  return "generic";
}

const quoteStr = (s) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');

export function renderStub(framework, description) {
  const d = escape(description);
  switch (framework) {
    case "vitest":
    case "jest":
      return `// ${MARKER}\nit.todo("${d}");\n`;
    case "node":
      return `// ${MARKER}\ntest.todo("${d}");\n`;
    case "pytest":
      return `# ${MARKER}\n@pytest.mark.skip(reason="TODO from audit: ${d}")\ndef test_todo_${slug(description)}():\n    ...\n`;
    case "go":
      return `// ${MARKER}\nfunc TestTodo${pascal(description)}(t *testing.T) {\n\tt.Skip("TODO from audit: ${d}")\n}\n`;
    case "rust":
      return `// ${MARKER}\n#[test]\n#[ignore = "TODO from audit: ${d}"]\nfn todo_${slug(description)}() {}\n`;
    case "dart":
      return `// ${MARKER}\ntest("${d}", () {}, skip: "TODO from audit");\n`;
    default:
      return `// ${MARKER}\n// TODO test: ${description}\n`;
  }
}

function slug(s) {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 48) || "case"
  );
}
function pascal(s) {
  return (
    s
      .replace(/[^A-Za-z0-9]+/g, " ")
      .trim()
      .split(" ")
      .map((w) => w[0]?.toUpperCase() + w.slice(1))
      .join("")
      .slice(0, 48) || "Case"
  );
}

/** Append stubs for descriptions not already present. Returns the new content and the added list. */
export function appendStubs(content, descriptions, framework) {
  const added = [];
  let out = content;
  for (const d of descriptions) {
    if (content.includes(escape(d)) || out.includes(escape(d))) continue;
    if (!out.endsWith("\n")) out += "\n";
    out += `\n${renderStub(framework, d)}`;
    added.push(d);
  }
  return { content: out, added };
}

async function main() {
  const argv = process.argv.slice(2);
  const get = (k) => (argv.includes(k) ? argv[argv.indexOf(k) + 1] : undefined);
  const verdictFile = get("--verdict");
  const into = get("--into");
  if (!verdictFile || !into) {
    console.error(
      "usage: add_test_stubs.mjs --verdict <audit-reply.md> --into <test file> [--framework auto|node|vitest|jest|pytest|go|rust|dart|generic]",
    );
    return 2;
  }
  const verdict = await readFile(resolve(verdictFile), "utf8");
  const missing = parseMissingTests(verdict);
  if (missing.length === 0) {
    console.log("No MISSING TESTS in the verdict; nothing to add.");
    return 0;
  }
  const content = await readFile(resolve(into), "utf8").catch(() => "");
  const framework =
    (get("--framework") ?? "auto") === "auto" ? detectFramework(into, content) : get("--framework");
  const { content: next, added } = appendStubs(content, missing, framework);
  if (added.length === 0) {
    console.log(`All ${missing.length} missing test(s) already present in ${into}.`);
    return 0;
  }
  await writeFile(resolve(into), next);
  console.log(`Added ${added.length} ${framework} stub(s) to ${into}:`);
  for (const d of added) console.log(`  - ${d}`);
  console.log("Fill them in yourself or hand them to the executor as the next packet.");
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(await main());
}
