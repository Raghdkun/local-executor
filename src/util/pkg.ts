import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

interface PkgJson {
  name: string;
  version: string;
}

let cached: { root: string; pkg: PkgJson } | null = null;

/**
 * Locate the package root (the directory holding our package.json) from
 * wherever this module runs: `dist/cli.js` after bundling, or `src/util/`
 * under vitest.
 */
export function packageRoot(): string {
  return locate().root;
}

export function packageVersion(): string {
  return locate().pkg.version;
}

/** Absolute path to the shipped `skill/` directory. */
export function skillSourceDir(): string {
  return join(packageRoot(), "skill");
}

function locate(): { root: string; pkg: PkgJson } {
  if (cached) return cached;
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as PkgJson;
      if (pkg.name === "local-executor") {
        cached = { root: dir, pkg };
        return cached;
      }
    } catch {
      // keep walking
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error("local-executor: cannot locate package root (package.json not found)");
}
