import { describe, expect, it } from "vitest";
import { parseAgentList } from "../../src/agents/types.js";

describe("parseAgentList", () => {
  it("parses, trims, dedupes, and accepts aliases", () => {
    expect(parseAgentList("claude, codex,claude")).toEqual(["claude", "codex"]);
    expect(parseAgentList("claude-code,codex-cli")).toEqual(["claude", "codex"]);
    expect(parseAgentList("")).toEqual([]);
  });
  it("rejects unknown agents", () => {
    expect(() => parseAgentList("claude,copilot")).toThrow(/Unknown agent "copilot"/);
  });
});
