import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { delimiter, join } from "node:path";
import { execa, type Options } from "execa";

export interface RunResult {
  ok: boolean;
  exitCode: number | undefined;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  cwd?: string;
  env?: Record<string, string>;
  /** Stream output to the user's terminal instead of capturing it. */
  inherit?: boolean;
  timeoutMs?: number;
}

/**
 * Run a command without a shell. Never throws on non-zero exit; inspect `ok`.
 * Throws only when the binary cannot be spawned (ENOENT etc.) — callers that
 * probe for tools should use `which()` first.
 */
export async function run(
  file: string,
  args: string[] = [],
  opts: RunOptions = {},
): Promise<RunResult> {
  const options: Options = {
    reject: false,
    stdio: opts.inherit ? "inherit" : "pipe",
    windowsHide: true,
    ...(opts.cwd ? { cwd: opts.cwd } : {}),
    ...(opts.env ? { env: opts.env } : {}),
    ...(opts.timeoutMs ? { timeout: opts.timeoutMs } : {}),
  };
  const result = await execa(file, args, options);
  return {
    ok: result.exitCode === 0,
    exitCode: result.exitCode,
    stdout: typeof result.stdout === "string" ? result.stdout : "",
    stderr: typeof result.stderr === "string" ? result.stderr : "",
  };
}

/**
 * Locate an executable on PATH without spawning a shell. Honors PATHEXT on
 * Windows so `ollama` resolves to `ollama.exe`.
 */
export async function which(
  cmd: string,
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): Promise<string | null> {
  const pathVar = env.PATH ?? env.Path ?? "";
  const dirs = pathVar.split(delimiter).filter(Boolean);
  const exts =
    platform === "win32"
      ? (env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM").split(";").map((e) => e.toLowerCase())
      : [""];
  for (const dir of dirs) {
    for (const ext of exts) {
      const candidate = join(dir, cmd.toLowerCase().endsWith(ext) && ext ? cmd : cmd + ext);
      try {
        await access(candidate, platform === "win32" ? constants.F_OK : constants.X_OK);
        return candidate;
      } catch {
        // keep looking
      }
    }
  }
  return null;
}

/** Start a long-running process detached from this one and forget about it. */
export function spawnDetached(
  file: string,
  args: string[] = [],
  opts: { cwd?: string } = {},
): void {
  const options: Options = {
    detached: true,
    stdio: "ignore",
    cleanup: false,
    windowsHide: true,
    reject: false,
    ...(opts.cwd ? { cwd: opts.cwd } : {}),
  };
  execa(file, args, options).nodeChildProcess.unref();
}

/** Open a URL in the default browser. Returns false if no opener is available. */
export async function openUrl(
  url: string,
  platform: NodeJS.Platform = process.platform,
): Promise<boolean> {
  try {
    if (platform === "darwin") await execa("open", [url], { reject: false });
    else if (platform === "win32")
      await execa("rundll32", ["url.dll,FileProtocolHandler", url], {
        reject: false,
        windowsHide: true,
      });
    else await execa("xdg-open", [url], { reject: false });
    return true;
  } catch {
    return false;
  }
}

/** Render a command the way a user would type it, for display before running. */
export function displayCommand(file: string, args: string[]): string {
  const quote = (s: string): string => (/[\s"']/.test(s) ? JSON.stringify(s) : s);
  return [file, ...args].map(quote).join(" ");
}
