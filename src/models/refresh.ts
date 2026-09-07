/**
 * Live check of the model catalog against ollama.com. Pure parsers plus one
 * orchestrator that takes a fetch implementation, so tests never hit the network.
 */
import type { FetchLike } from "../ollama/client.js";
import { type CatalogModel, catalog, lastVerified, type ModelFamily } from "./catalog.js";

export const OLLAMA_LIBRARY = "https://ollama.com/library";

export interface RemoteTag {
  tag: string;
  sizeGB: number | null;
  contextK: number | null;
  /** Free-text age from the page, e.g. "1 week ago". */
  updated: string | null;
}

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ");
}

/** Parse `https://ollama.com/library/<family>/tags` into tags with sizes. */
export function parseTagsPage(html: string, family: string): RemoteTag[] {
  const text = stripHtml(html);
  const re = new RegExp(
    `${family.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}:([A-Za-z0-9._-]+)`,
    "g",
  );
  const out = new Map<string, RemoteTag>();
  for (const m of text.matchAll(re)) {
    const tag = `${family}:${m[1]}`;
    if (out.has(tag)) continue;
    const seg = text.slice(m.index ?? 0, (m.index ?? 0) + 260);
    const size = /(\d+(?:\.\d+)?)\s*(GB|MB)/.exec(seg);
    const ctx = /(\d+)K\s*context/.exec(seg);
    const age = /(\d+\s+(?:minute|hour|day|week|month|year)s?\s+ago)/.exec(seg);
    out.set(tag, {
      tag,
      sizeGB: size
        ? size[2] === "GB"
          ? Number(size[1])
          : Math.round((Number(size[1]) / 1024) * 10) / 10
        : null,
      contextK: ctx ? Number(ctx[1]) : null,
      updated: age?.[1] ?? null,
    });
  }
  return [...out.values()];
}

/** Model names from `https://ollama.com/library?sort=newest`, in page order. */
export function parseLibraryList(html: string): string[] {
  const names: string[] = [];
  for (const m of html.matchAll(/href="\/library\/([a-z0-9][a-z0-9._-]*)"/g)) {
    const n = m[1] as string;
    if (!names.includes(n)) names.push(n);
  }
  return names;
}

/** Families we would consider for a code executor, beyond those in the catalog. */
export const codingFamilies =
  /qwen|gemma|devstral|codestral|deepseek|coder|glm|mistral|llama|phi|granite|starcoder/i;

export interface CatalogDiff {
  family: ModelFamily;
  /** Catalog tags that no longer exist on ollama.com. */
  missing: string[];
  /** Catalog tags whose download size changed by more than 10%. */
  sizeChanged: { tag: string; catalogGB: number; remoteGB: number }[];
  /** Plain tags in this family that are not in the catalog (quantization variants excluded). */
  newTags: RemoteTag[];
}

/** Ignore quantization and format variants; those are choices, not new models. */
export function isBaseTag(tag: string): boolean {
  const variant = tag.slice(tag.indexOf(":") + 1);
  return (
    !/-(q\d|bf16|fp16|mxfp8|nvfp4|int[48]|mlx|it-|qat|mtp|cloud)/.test(variant) &&
    variant !== "latest" &&
    variant !== "cloud"
  );
}

export function diffFamily(
  family: ModelFamily,
  remote: RemoteTag[],
  local: readonly CatalogModel[] = catalog,
): CatalogDiff {
  const remoteByTag = new Map(remote.map((r) => [r.tag, r]));
  const mine = local.filter((m) => m.family === family);
  const missing: string[] = [];
  const sizeChanged: CatalogDiff["sizeChanged"] = [];
  for (const m of mine) {
    const lookup = m.tag.includes(":") ? m.tag : `${m.tag}:latest`;
    const r = remoteByTag.get(lookup);
    if (!r) {
      missing.push(m.tag);
      continue;
    }
    if (r.sizeGB !== null && Math.abs(r.sizeGB - m.sizeGB) / m.sizeGB > 0.1) {
      sizeChanged.push({ tag: m.tag, catalogGB: m.sizeGB, remoteGB: r.sizeGB });
    }
  }
  const known = new Set(mine.map((m) => (m.tag.includes(":") ? m.tag : `${m.tag}:latest`)));
  const newTags = remote.filter((r) => isBaseTag(r.tag) && !known.has(r.tag));
  return { family, missing, sizeChanged, newTags };
}

export interface RefreshReport {
  checkedAt: string;
  lastVerified: string;
  /** Days since the catalog was last verified by a maintainer. */
  catalogAgeDays: number;
  families: CatalogDiff[];
  /** Newest library entries that look like coding-capable families and are not catalog families. */
  newFamilies: string[];
  errors: string[];
}

export function catalogAgeDays(now: Date = new Date()): number {
  return Math.floor((now.getTime() - new Date(lastVerified).getTime()) / 86_400_000);
}

export async function refreshCatalog(
  fetchImpl: FetchLike,
  now: Date = new Date(),
): Promise<RefreshReport> {
  const families = [...new Set(catalog.map((m) => m.family))];
  const report: RefreshReport = {
    checkedAt: now.toISOString(),
    lastVerified,
    catalogAgeDays: catalogAgeDays(now),
    families: [],
    newFamilies: [],
    errors: [],
  };
  for (const family of families) {
    try {
      const res = await fetchImpl(`${OLLAMA_LIBRARY}/${family}/tags`, {
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      report.families.push(diffFamily(family, parseTagsPage(await res.text(), family)));
    } catch (err) {
      report.errors.push(`${family}: ${(err as Error).message}`);
    }
  }
  try {
    const res = await fetchImpl(`${OLLAMA_LIBRARY}?sort=newest`, {
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const names = parseLibraryList(await res.text()).slice(0, 40);
    report.newFamilies = names.filter(
      (n) => codingFamilies.test(n) && !families.includes(n as ModelFamily),
    );
  } catch (err) {
    report.errors.push(`library list: ${(err as Error).message}`);
  }
  return report;
}

/** One-paragraph summary for agents and humans. */
export function summarizeRefresh(r: RefreshReport): string[] {
  const lines: string[] = [];
  lines.push(
    `Catalog last verified ${r.lastVerified} (${r.catalogAgeDays} days ago); checked ollama.com ${r.checkedAt.slice(0, 10)}.`,
  );
  for (const f of r.families) {
    if (f.missing.length)
      lines.push(`${f.family}: catalog tags no longer on ollama.com: ${f.missing.join(", ")}`);
    for (const s of f.sizeChanged)
      lines.push(`${f.family}: ${s.tag} is now ~${s.remoteGB} GB (catalog says ${s.catalogGB} GB)`);
    if (f.newTags.length)
      lines.push(
        `${f.family}: newer/other tags not in the catalog: ${f.newTags.map((t) => `${t.tag}${t.sizeGB ? ` (~${t.sizeGB} GB)` : ""}`).join(", ")}`,
      );
  }
  if (r.newFamilies.length)
    lines.push(
      `Newest coding-capable families on ollama.com not in the catalog: ${r.newFamilies.join(", ")}`,
    );
  if (
    r.families.length &&
    r.families.every((f) => !f.missing.length && !f.sizeChanged.length && !f.newTags.length) &&
    !r.newFamilies.length
  ) {
    lines.push("Catalog matches ollama.com; nothing newer in these families.");
  }
  for (const e of r.errors) lines.push(`Could not check ${e}`);
  return lines;
}
