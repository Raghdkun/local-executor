import type { InstallOutcome } from "../agents/install.js";
import type { AgentDetection, AgentId } from "../agents/types.js";
import type { HardwareProfile } from "../hardware/types.js";
import type { RecommendationReport } from "../models/recommend.js";
import type { Benchmark, OllamaClient, WarmupResult } from "../ollama/client.js";

export interface InitOptions {
  yes: boolean;
  json: boolean;
  ollamaUrl: string;
  ollamaToken?: string;
  ollamaTokenEnv?: string;
  model?: string;
  agents?: AgentId[];
  skipOllama: boolean;
  skipPull: boolean;
  skipVerify: boolean;
  /** undefined = decide interactively / by default; true|false = forced by flag. */
  project?: boolean;
  /** Allow privileged installs (Ollama) without a prompt in --yes mode. */
  allowInstall: boolean;
}

export interface VerifyResult {
  root: string;
  check: "READY" | "NOT RUNNING" | "MISSING MODEL" | "BROKEN CONFIG" | "ERROR";
  checkMessage: string;
  packet: "pass" | "fail" | "skipped";
  packetDetail: string;
  tokensPerSec: number | null;
}

export interface RunContext {
  opts: InitOptions;
  client: OllamaClient;
  cwd: string;
  ollama: {
    binary: string | null;
    version: string | null;
    latest: string | null;
    skipped: boolean;
  };
  hw?: HardwareProfile;
  report?: RecommendationReport;
  model?: string;
  modelSizeGB?: number;
  pulled?: boolean;
  warmup?: WarmupResult | null;
  benchmark?: Benchmark | null;
  detections: AgentDetection[];
  agents: AgentId[];
  projectRoot: string | null;
  installProject: boolean;
  installs: InstallOutcome[];
  verify: VerifyResult[];
  warnings: string[];
}
