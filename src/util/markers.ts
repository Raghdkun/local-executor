/**
 * Marker-delimited blocks let us append to files we do not own (AGENTS.md,
 * shared rules files) and replace our block cleanly on re-run or uninstall.
 */

export const START_MARKER = "<!-- lex:start -->";
export const END_MARKER = "<!-- lex:end -->";

export interface Markers {
  start: string;
  end: string;
}

export const defaultMarkers: Markers = { start: START_MARKER, end: END_MARKER };

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function blockRegex(m: Markers): RegExp {
  return new RegExp(`${escapeRegExp(m.start)}[\\s\\S]*?${escapeRegExp(m.end)}\\n?`, "g");
}

export function hasBlock(content: string, m: Markers = defaultMarkers): boolean {
  return content.includes(m.start) && content.includes(m.end);
}

export function wrapBlock(body: string, m: Markers = defaultMarkers): string {
  const trimmed = body.replace(/\s+$/, "");
  return `${m.start}\n${trimmed}\n${m.end}\n`;
}

/**
 * Insert or replace the marked block. When absent, the block is appended after
 * a blank line. Existing content outside the markers is left byte-for-byte.
 */
export function upsertBlock(content: string, body: string, m: Markers = defaultMarkers): string {
  const block = wrapBlock(body, m);
  if (hasBlock(content, m)) {
    return content.replace(blockRegex(m), block);
  }
  if (content.length === 0) return block;
  const sep = content.endsWith("\n\n") ? "" : content.endsWith("\n") ? "\n" : "\n\n";
  return `${content}${sep}${block}`;
}

/**
 * Remove the marked block together with the blank line that `upsertBlock`
 * inserted before it. Returns the original string when no block exists.
 */
export function removeBlock(content: string, m: Markers = defaultMarkers): string {
  if (!hasBlock(content, m)) return content;
  const re = new RegExp(`\\n*${escapeRegExp(m.start)}[\\s\\S]*?${escapeRegExp(m.end)}\\n?`, "g");
  let sawContentBefore = false;
  const out = content.replace(re, (_whole, offset: number) => {
    sawContentBefore = content.slice(0, offset).trim().length > 0;
    return sawContentBefore ? "\n" : "";
  });
  return out;
}

/** Extract the body between markers, or null. */
export function extractBlock(content: string, m: Markers = defaultMarkers): string | null {
  const re = new RegExp(`${escapeRegExp(m.start)}\\n?([\\s\\S]*?)\\n?${escapeRegExp(m.end)}`);
  const match = re.exec(content);
  return match?.[1] ?? null;
}
