import { describe, expect, it } from "vitest";
import { type DetectAgentDeps, detectAgents } from "../../src/agents/detect.js";

function deps(overrides: Partial<DetectAgentDeps> = {}): DetectAgentDeps {
  return {
    which: async () => null,
    exists: async () => false,
    home: "/Users/x",
    platform: "darwin",
    env: {},
    ...overrides,
  };
}

describe("detectAgents", () => {
  it("detects nothing on a clean machine", async () => {
    const r = await detectAgents(deps());
    expect(r.map((a) => a.detected)).toEqual([false, false, false, false]);
    expect(r.map((a) => a.id)).toEqual(["claude", "codex", "cursor", "windsurf"]);
  });

  it("detects Claude from PATH and Codex from its home dir", async () => {
    const r = await detectAgents(
      deps({
        which: async (c) => (c === "claude" ? "/usr/local/bin/claude" : null),
        exists: async (p) => p === "/Users/x/.codex",
      }),
    );
    const byId = Object.fromEntries(r.map((a) => [a.id, a]));
    expect(byId.claude?.detected).toBe(true);
    expect(byId.claude?.evidence).toEqual(["claude on PATH"]);
    expect(byId.codex?.evidence).toEqual(["~/.codex exists"]);
    expect(byId.cursor?.detected).toBe(false);
  });

  it("detects Cursor and Windsurf apps on macOS and Windows", async () => {
    const mac = await detectAgents(
      deps({
        exists: async (p) => p === "/Applications/Cursor.app" || p === "/Applications/Windsurf.app",
      }),
    );
    expect(mac.find((a) => a.id === "cursor")?.detected).toBe(true);
    expect(mac.find((a) => a.id === "windsurf")?.detected).toBe(true);

    const win = await detectAgents(
      deps({
        platform: "win32",
        env: { LOCALAPPDATA: "C:\\Users\\x\\AppData\\Local" },
        exists: async (p) => /Programs[\\/]cursor$/.test(p),
      }),
    );
    expect(win.find((a) => a.id === "cursor")?.detected).toBe(true);
    expect(win.find((a) => a.id === "windsurf")?.detected).toBe(false);
  });

  it("treats probe errors as not detected", async () => {
    const r = await detectAgents(
      deps({
        which: async () => {
          throw new Error("boom");
        },
      }),
    );
    expect(r.every((a) => !a.detected)).toBe(true);
  });
});
