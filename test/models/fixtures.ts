import type { HardwareProfile } from "../../src/hardware/types.js";

export function hw(overrides: Partial<HardwareProfile> = {}): HardwareProfile {
  return {
    platform: "darwin",
    arch: "arm64",
    cpuModel: "Apple M4",
    physicalCores: 10,
    logicalCores: 10,
    totalRamGB: 16,
    freeRamGB: 6,
    gpu: { kind: "apple", model: "Apple M4", vramGB: null },
    freeDiskGB: 200,
    modelsDir: "/Users/x/.ollama/models",
    ...overrides,
  };
}

export const pcNvidia16 = (): HardwareProfile =>
  hw({
    platform: "win32",
    arch: "x64",
    cpuModel: "AMD Ryzen 7 7800X3D",
    physicalCores: 8,
    logicalCores: 16,
    totalRamGB: 32,
    freeRamGB: 20,
    gpu: { kind: "nvidia", model: "NVIDIA GeForce RTX 4080", vramGB: 16 },
    modelsDir: "C:\\Users\\x\\.ollama\\models",
  });

export const linuxCpuOnly = (ramGB: number, cores = 8): HardwareProfile =>
  hw({
    platform: "linux",
    arch: "x64",
    cpuModel: "Intel Core i5",
    physicalCores: cores,
    logicalCores: cores * 2,
    totalRamGB: ramGB,
    freeRamGB: ramGB / 2,
    gpu: { kind: "none", model: "", vramGB: null },
    modelsDir: "/home/x/.ollama/models",
  });
