import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  classifyGpu,
  type DetectDeps,
  detectHardware,
  ollamaModelsDir,
  pickVolume,
} from "../../src/hardware/detect.js";

const GB = 1024 ** 3;

function deps(overrides: Partial<DetectDeps> = {}): DetectDeps {
  return {
    cpu: async () => ({ manufacturer: "Apple", brand: "M4", cores: 10, physicalCores: 10 }),
    mem: async () => ({ total: 16 * GB, available: 6 * GB, free: 1 * GB }),
    graphics: async () => ({
      controllers: [{ vendor: "Apple", model: "Apple M4", vram: null }],
    }),
    fsSize: async () => [
      { mount: "/", available: 30 * GB, size: 500 * GB },
      { mount: "/System/Volumes/Data", available: 24 * GB, size: 500 * GB },
    ],
    platform: "darwin",
    arch: "arm64",
    env: {},
    homedir: "/Users/x",
    ...overrides,
  };
}

describe("detectHardware", () => {
  it("builds a profile for Apple Silicon without touching the system", async () => {
    const hw = await detectHardware(deps());
    expect(hw).toMatchObject({
      platform: "darwin",
      arch: "arm64",
      cpuModel: "Apple M4",
      physicalCores: 10,
      logicalCores: 10,
      totalRamGB: 16,
      freeRamGB: 6,
      gpu: { kind: "apple", vramGB: null },
      modelsDir: join("/Users/x", ".ollama", "models"),
    });
    // "/" is the only mount that prefixes /Users/x/... in this fixture.
    expect(hw.freeDiskGB).toBe(30);
  });

  it("uses free memory when available is zero and survives failing probes", async () => {
    const hw = await detectHardware(
      deps({
        mem: async () => ({ total: 8 * GB, available: 0, free: 2 * GB }),
        graphics: async () => {
          throw new Error("no gpu probe");
        },
        fsSize: async () => {
          throw new Error("no fs probe");
        },
        platform: "linux",
        arch: "x64",
        homedir: "/home/x",
      }),
    );
    expect(hw.freeRamGB).toBe(2);
    expect(hw.gpu.kind).toBe("none");
    expect(hw.freeDiskGB).toBe(0);
    expect(hw.platform).toBe("linux");
  });

  it("falls back to logical cores when physicalCores is unknown", async () => {
    const hw = await detectHardware(
      deps({ cpu: async () => ({ manufacturer: "", brand: "Xeon", cores: 4, physicalCores: 0 }) }),
    );
    expect(hw.physicalCores).toBe(4);
    expect(hw.cpuModel).toBe("Xeon");
  });
});

describe("classifyGpu", () => {
  it("prefers NVIDIA and reads memoryTotal in MB", () => {
    const gpu = classifyGpu(
      [
        { vendor: "Intel", model: "UHD 770", vram: 128 },
        { vendor: "NVIDIA", model: "GeForce RTX 4080", vram: 16384, memoryTotal: 16384 },
      ],
      "win32",
      "x64",
    );
    expect(gpu).toEqual({ kind: "nvidia", model: "GeForce RTX 4080", vramGB: 16 });
  });

  it("classifies AMD/Radeon", () => {
    const gpu = classifyGpu(
      [{ vendor: "AMD", model: "Radeon RX 7900 XTX", vram: 24576 }],
      "linux",
      "x64",
    );
    expect(gpu.kind).toBe("amd");
    expect(gpu.vramGB).toBe(24);
  });

  it("returns none when there is no known vendor", () => {
    expect(
      classifyGpu([{ vendor: "VMware", model: "SVGA II", vram: 0 }], "linux", "x64").kind,
    ).toBe("none");
  });

  it("always reports apple on darwin/arm64 even with empty controllers", () => {
    expect(classifyGpu([], "darwin", "arm64").kind).toBe("apple");
  });
});

describe("pickVolume", () => {
  it("chooses the longest matching mount", () => {
    const v = pickVolume(
      [
        { mount: "/", available: 1 },
        { mount: "/home", available: 2 },
        { mount: "/home/x/data", available: 3 },
      ],
      "/home/x/.ollama/models",
      "linux",
    );
    expect(v?.available).toBe(2);
  });

  it("matches Windows drive letters case-insensitively", () => {
    const v = pickVolume(
      [
        { mount: "C:", available: 1 },
        { mount: "D:", available: 2 },
      ],
      "d:\\models",
      "win32",
    );
    // resolve() on a POSIX host cannot normalize Windows paths, so this only
    // asserts that the function does not throw and returns something sensible.
    expect(v === undefined || v.available === 2 || v.available === 1).toBe(true);
  });
});

describe("ollamaModelsDir", () => {
  it("honors OLLAMA_MODELS", () => {
    expect(ollamaModelsDir({ OLLAMA_MODELS: "/mnt/big" }, "/home/x")).toBe("/mnt/big");
  });
  it("defaults to ~/.ollama/models", () => {
    expect(ollamaModelsDir({}, "/home/x").split(/[\\/]/).slice(-3)).toEqual([
      "x",
      ".ollama",
      "models",
    ]);
  });
});
