import { access, cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";

export async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

export async function isDirectory(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isDirectory();
  } catch {
    return false;
  }
}

export async function ensureDir(p: string): Promise<void> {
  await mkdir(p, { recursive: true });
}

export async function readJson<T>(p: string): Promise<T> {
  return JSON.parse(await readFile(p, "utf8")) as T;
}

export async function readJsonOr<T>(p: string, fallback: T): Promise<T> {
  try {
    return await readJson<T>(p);
  } catch {
    return fallback;
  }
}

export async function writeJson(p: string, value: unknown): Promise<void> {
  await ensureDir(dirname(p));
  await writeFile(p, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export async function writeText(p: string, content: string): Promise<void> {
  await ensureDir(dirname(p));
  await writeFile(p, content, "utf8");
}

export async function readTextOr(p: string, fallback = ""): Promise<string> {
  try {
    return await readFile(p, "utf8");
  } catch {
    return fallback;
  }
}

/** Recursively copy a directory. Returns the list of files written (absolute). */
export async function copyDir(src: string, dest: string): Promise<string[]> {
  await ensureDir(dest);
  await cp(src, dest, { recursive: true, force: true });
  return listFiles(dest);
}

export async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await listFiles(p)));
    else out.push(p);
  }
  return out.sort();
}

export async function removePath(p: string): Promise<void> {
  await rm(p, { recursive: true, force: true });
}

export function home(): string {
  return homedir();
}

/** Expand a leading `~` to the home directory. */
export function expandTilde(p: string): string {
  if (p === "~") return home();
  if (p.startsWith("~/") || p.startsWith("~\\")) return join(home(), p.slice(2));
  return p;
}

/** Replace the home directory prefix with `~` for display. */
export function contractTilde(p: string): string {
  const h = home();
  if (p === h) return "~";
  if (p.startsWith(h + sep)) return `~${p.slice(h.length)}`;
  return p;
}

/** Forward-slash form for embedding in Markdown/JS regardless of OS. */
export function toPosix(p: string): string {
  return p.split("\\").join("/");
}

export function absolute(p: string): string {
  return resolve(expandTilde(p));
}

/** Walk up from `start` looking for a `.git` entry. Returns the repo root or null. */
export async function findGitRoot(start: string): Promise<string | null> {
  let dir = resolve(start);
  for (;;) {
    if (await exists(join(dir, ".git"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}
