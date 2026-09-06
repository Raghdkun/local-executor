import { describe, expect, it } from "vitest";
import { planOllamaInstall } from "../../src/ollama/install.js";
import { upgradePlan } from "../../src/steps/ollama.js";

describe("upgradePlan", () => {
  it("turns brew install into brew upgrade", () => {
    const p = upgradePlan(
      planOllamaInstall({ platform: "darwin", hasBrew: true, hasWinget: false }),
    );
    expect(p).toMatchObject({
      kind: "command",
      file: "brew",
      args: ["upgrade", "ollama"],
      display: "brew upgrade ollama",
    });
  });
  it("turns winget install into winget upgrade", () => {
    const p = upgradePlan(
      planOllamaInstall({ platform: "win32", hasBrew: false, hasWinget: true }),
    );
    expect(p.kind).toBe("command");
    if (p.kind === "command")
      expect(p.args.slice(0, 3)).toEqual(["upgrade", "--id", "Ollama.Ollama"]);
  });
  it("leaves the Linux script and download plans unchanged", () => {
    const linux = planOllamaInstall({ platform: "linux", hasBrew: false, hasWinget: false });
    expect(upgradePlan(linux)).toEqual(linux);
    const dl = planOllamaInstall({ platform: "darwin", hasBrew: false, hasWinget: false });
    expect(upgradePlan(dl)).toEqual(dl);
  });
});
