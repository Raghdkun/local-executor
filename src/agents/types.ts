export type AgentId = "claude" | "codex" | "cursor" | "windsurf";

export const allAgents: readonly AgentId[] = ["claude", "codex", "cursor", "windsurf"] as const;

export const agentNames: Record<AgentId, string> = {
  claude: "Claude Code",
  codex: "Codex CLI",
  cursor: "Cursor",
  windsurf: "Windsurf",
};

export interface AgentDetection {
  id: AgentId;
  name: string;
  detected: boolean;
  /** Human-readable evidence, e.g. "claude on PATH", "~/.codex exists". */
  evidence: string[];
}

export function parseAgentList(input: string): AgentId[] {
  const out: AgentId[] = [];
  for (const raw of input.split(",")) {
    const s = raw.trim().toLowerCase();
    if (!s) continue;
    const id = s === "claude-code" ? "claude" : s === "codex-cli" ? "codex" : s;
    if (!allAgents.includes(id as AgentId)) {
      throw new Error(`Unknown agent "${raw.trim()}". Choose from: ${allAgents.join(", ")}`);
    }
    if (!out.includes(id as AgentId)) out.push(id as AgentId);
  }
  return out;
}
