import { join } from "node:path";
import type { Platform } from "../hardware/types.js";
import { displayCommand } from "../util/exec.js";

export const OLLAMA_DOWNLOAD_URL = "https://ollama.com/download";
export const OLLAMA_LINUX_SCRIPT = "https://ollama.com/install.sh";

export interface InstallEnvironment {
  platform: Platform;
  hasBrew: boolean;
  hasWinget: boolean;
}

export type InstallPlan =
  | {
      kind: "command";
      file: string;
      args: string[];
      /** Exactly what we will run, for display. */
      display: string;
      /** One or two sentences on what the command does and what it needs. */
      explanation: string;
      /** True when the command may ask for sudo / admin rights. */
      privileged: boolean;
    }
  | {
      kind: "download";
      url: string;
      explanation: string;
    };

/** Decide how to install Ollama on this machine. Pure. */
export function planOllamaInstall(env: InstallEnvironment): InstallPlan {
  switch (env.platform) {
    case "darwin":
      if (env.hasBrew) {
        return {
          kind: "command",
          file: "brew",
          args: ["install", "ollama"],
          display: displayCommand("brew", ["install", "ollama"]),
          explanation:
            "Installs the Ollama CLI and server with Homebrew into your user prefix. No sudo. Later you can run `brew upgrade ollama`.",
          privileged: false,
        };
      }
      return {
        kind: "download",
        url: OLLAMA_DOWNLOAD_URL,
        explanation:
          "Homebrew is not installed, so download the macOS app from ollama.com, drag it to Applications, open it once, then re-run lex.",
      };
    case "linux":
      return {
        kind: "command",
        file: "sh",
        args: ["-c", `curl -fsSL ${OLLAMA_LINUX_SCRIPT} | sh`],
        display: `curl -fsSL ${OLLAMA_LINUX_SCRIPT} | sh`,
        explanation:
          "Runs Ollama's official install script. It downloads the binary to /usr/local, creates an `ollama` system user and a systemd service, and installs GPU drivers hooks if it finds NVIDIA/AMD hardware. It will ask for sudo.",
        privileged: true,
      };
    case "win32":
      if (env.hasWinget) {
        return {
          kind: "command",
          file: "winget",
          args: [
            "install",
            "--id",
            "Ollama.Ollama",
            "-e",
            "--accept-source-agreements",
            "--accept-package-agreements",
          ],
          display: displayCommand("winget", ["install", "--id", "Ollama.Ollama", "-e"]),
          explanation:
            "Installs Ollama for Windows with winget (per-user install, no admin needed). It also installs the tray app that keeps the server running.",
          privileged: false,
        };
      }
      return {
        kind: "download",
        url: OLLAMA_DOWNLOAD_URL,
        explanation:
          "winget is not available, so download OllamaSetup.exe from ollama.com, run it, then re-run lex.",
      };
  }
}

export interface ServerStartPlan {
  file: string;
  args: string[];
  display: string;
  /** Whether this launches the GUI app (macOS/Windows) instead of a bare server. */
  usesApp: boolean;
}

/** How to start the server when it is installed but not running. Pure. */
export function planServerStart(
  platform: Platform,
  opts: { macAppPresent?: boolean; winAppPath?: string | null } = {},
): ServerStartPlan {
  if (platform === "darwin" && opts.macAppPresent) {
    return { file: "open", args: ["-a", "Ollama"], display: "open -a Ollama", usesApp: true };
  }
  if (platform === "win32" && opts.winAppPath) {
    return { file: opts.winAppPath, args: [], display: `"${opts.winAppPath}"`, usesApp: true };
  }
  return { file: "ollama", args: ["serve"], display: "ollama serve  (detached)", usesApp: false };
}

/** Candidate locations of the Ollama GUI app, per OS. */
export function appCandidates(platform: Platform, env: NodeJS.ProcessEnv): string[] {
  if (platform === "darwin")
    return ["/Applications/Ollama.app", join(env.HOME ?? "", "Applications", "Ollama.app")];
  if (platform === "win32") {
    const local = env.LOCALAPPDATA ?? "";
    return [join(local, "Programs", "Ollama", "ollama app.exe")];
  }
  return [];
}
