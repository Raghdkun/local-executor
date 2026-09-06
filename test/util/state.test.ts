import { describe, expect, it } from "vitest";
import {
  emptyManifest,
  type InstallRecord,
  installKey,
  upsertInstall,
} from "../../src/util/state.js";

const rec = (o: Partial<InstallRecord>): InstallRecord => ({
  agent: "codex",
  scope: "user",
  root: "/h/.codex/local-executor",
  configPath: "/h/.codex/local-executor/runtime/config.json",
  owned: ["/h/.codex/local-executor"],
  marked: ["/h/.codex/AGENTS.md"],
  installedAt: "2026-09-06T00:00:00.000Z",
  version: "0.1.0",
  ...o,
});

describe("manifest upsert", () => {
  it("keeps user and project installs that share a root as separate records", () => {
    let m = emptyManifest();
    m = upsertInstall(m, rec({}));
    m = upsertInstall(m, rec({ scope: "project", owned: [], marked: ["/repo/AGENTS.md"] }));
    m = upsertInstall(m, rec({ scope: "project", owned: [], marked: ["/other/AGENTS.md"] }));
    expect(m.installs).toHaveLength(3);
  });

  it("replaces a re-install of the same identity", () => {
    let m = emptyManifest();
    m = upsertInstall(m, rec({ version: "0.1.0" }));
    m = upsertInstall(m, rec({ version: "0.2.0" }));
    expect(m.installs).toHaveLength(1);
    expect(m.installs[0]?.version).toBe("0.2.0");
    m = upsertInstall(
      m,
      rec({ scope: "project", owned: ["/repo/.cursor/rules/x.mdc"], marked: [] }),
    );
    m = upsertInstall(
      m,
      rec({ scope: "project", owned: ["/repo/.cursor/rules/x.mdc"], marked: [] }),
    );
    expect(m.installs).toHaveLength(2);
  });

  it("installKey ignores the anchor for user scope", () => {
    expect(installKey(rec({ owned: ["a"] }))).toBe(installKey(rec({ owned: ["b"] })));
  });
});
