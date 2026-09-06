import { join } from "node:path";
import type { Platform } from "../hardware/types.js";
import { type AgentDetection, type AgentId, agentNames, allAgents } from "./types.js";

export interface DetectAgentDeps {
  which: (cmd: string) => Promise<string | null>;
  exists: (p: string) => Promise<boolean>;
  home: string;
  platform: Platform;
  env: NodeJS.ProcessEnv;
}

interface Probe {
  label: string;
  check: (d: DetectAgentDeps) => Promise<boolean>;
}

function pathProbe(cmd: string): Probe {
  return { label: `${cmd} on PATH`, check: async (d) => (await d.which(cmd)) !== null };
}

function dirProbe(rel: string): Probe {
  return { label: `~/${rel} exists`, check: async (d) => d.exists(join(d.home, rel)) };
}

function appProbe(platform: Platform, label: string, path: (d: DetectAgentDeps) => string): Probe {
  return {
    label,
    check: async (d) => d.platform === platform && d.exists(path(d)),
  };
}

const probes: Record<AgentId, Probe[]> = {
  claude: [pathProbe("claude"), dirProbe(".claude")],
  codex: [pathProbe("codex"), dirProbe(".codex")],
  cursor: [
    pathProbe("cursor"),
    dirProbe(".cursor"),
    appProbe("darwin", "Cursor.app installed", () => "/Applications/Cursor.app"),
    appProbe("win32", "Cursor installed", (d) =>
      join(d.env.LOCALAPPDATA ?? "", "Programs", "cursor"),
    ),
  ],
  windsurf: [
    pathProbe("windsurf"),
    dirProbe(".codeium/windsurf"),
    appProbe("darwin", "Windsurf.app installed", () => "/Applications/Windsurf.app"),
    appProbe("win32", "Windsurf installed", (d) =>
      join(d.env.LOCALAPPDATA ?? "", "Programs", "Windsurf"),
    ),
  ],
};

export async function detectAgents(deps: DetectAgentDeps): Promise<AgentDetection[]> {
  const out: AgentDetection[] = [];
  for (const id of allAgents) {
    const evidence: string[] = [];
    for (const p of probes[id]) {
      if (await p.check(deps).catch(() => false)) evidence.push(p.label);
    }
    out.push({ id, name: agentNames[id], detected: evidence.length > 0, evidence });
  }
  return out;
}
