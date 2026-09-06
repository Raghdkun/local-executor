import { describe, expect, it } from "vitest";
import { appCandidates, planOllamaInstall, planServerStart } from "../../src/ollama/install.js";

describe("planOllamaInstall", () => {
  it("macOS with Homebrew → brew install ollama", () => {
    const p = planOllamaInstall({ platform: "darwin", hasBrew: true, hasWinget: false });
    expect(p).toMatchObject({
      kind: "command",
      file: "brew",
      args: ["install", "ollama"],
      privileged: false,
    });
  });
  it("macOS without Homebrew → download page", () => {
    const p = planOllamaInstall({ platform: "darwin", hasBrew: false, hasWinget: false });
    expect(p.kind).toBe("download");
  });
  it("Linux → official script via sh -c, marked privileged", () => {
    const p = planOllamaInstall({ platform: "linux", hasBrew: false, hasWinget: false });
    expect(p).toMatchObject({ kind: "command", file: "sh", privileged: true });
    if (p.kind === "command") {
      expect(p.args[1]).toBe("curl -fsSL https://ollama.com/install.sh | sh");
      expect(p.display).toBe("curl -fsSL https://ollama.com/install.sh | sh");
    }
  });
  it("Windows with winget → winget install", () => {
    const p = planOllamaInstall({ platform: "win32", hasBrew: false, hasWinget: true });
    expect(p).toMatchObject({ kind: "command", file: "winget" });
    if (p.kind === "command") expect(p.args).toContain("Ollama.Ollama");
  });
  it("Windows without winget → download", () => {
    expect(planOllamaInstall({ platform: "win32", hasBrew: false, hasWinget: false }).kind).toBe(
      "download",
    );
  });
});

describe("planServerStart", () => {
  it("prefers the app on macOS/Windows when present", () => {
    expect(planServerStart("darwin", { macAppPresent: true })).toMatchObject({
      file: "open",
      usesApp: true,
    });
    expect(planServerStart("win32", { winAppPath: "C:\\x\\ollama app.exe" })).toMatchObject({
      usesApp: true,
    });
  });
  it("falls back to ollama serve", () => {
    expect(planServerStart("linux")).toMatchObject({
      file: "ollama",
      args: ["serve"],
      usesApp: false,
    });
    expect(planServerStart("darwin", { macAppPresent: false })).toMatchObject({ file: "ollama" });
  });
});

describe("appCandidates", () => {
  it("lists per-OS app locations", () => {
    expect(appCandidates("darwin", { HOME: "/Users/x" })).toContain("/Applications/Ollama.app");
    expect(appCandidates("win32", { LOCALAPPDATA: "C:\\Users\\x\\AppData\\Local" })[0]).toMatch(
      /ollama app\.exe$/,
    );
    expect(appCandidates("linux", {})).toEqual([]);
  });
});
