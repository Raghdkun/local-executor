import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("execa", () => ({
  execa: vi.fn(async (file: string, args: string[]) => ({
    exitCode: file === "false" ? 1 : 0,
    stdout: `${file} ${args.join(" ")}`.trim(),
    stderr: "",
  })),
}));

import { execa } from "execa";
import { displayCommand, run, which } from "../../src/util/exec.js";

describe("run", () => {
  it("returns ok=true on exit 0 and never throws on non-zero", async () => {
    const good = await run("echo", ["hi"]);
    expect(good).toMatchObject({ ok: true, exitCode: 0, stdout: "echo hi" });
    const bad = await run("false");
    expect(bad.ok).toBe(false);
    expect(execa).toHaveBeenCalledWith("false", [], expect.objectContaining({ reject: false }));
  });
});

describe("which", () => {
  it("finds an executable on a synthetic PATH without a shell", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lex-which-"));
    const bin = join(dir, "mytool");
    await writeFile(bin, "#!/bin/sh\n");
    await chmod(bin, 0o755);
    expect(await which("mytool", { PATH: `${dir}${delimiter}/nonexistent` }, "linux")).toBe(bin);
    expect(await which("nope", { PATH: dir }, "linux")).toBeNull();
  });

  it("uses PATHEXT on Windows", async () => {
    const dir = await mkdtemp(join(tmpdir(), "lex-which-"));
    await writeFile(join(dir, "ollama.exe"), "");
    const found = await which("ollama", { PATH: dir, PATHEXT: ".COM;.EXE" }, "win32");
    expect(found).toBe(join(dir, "ollama.exe"));
  });
});

describe("displayCommand", () => {
  it("quotes arguments with spaces", () => {
    expect(displayCommand("sh", ["-c", "curl -fsSL x | sh"])).toBe('sh -c "curl -fsSL x | sh"');
    expect(displayCommand("brew", ["install", "ollama"])).toBe("brew install ollama");
  });
});
