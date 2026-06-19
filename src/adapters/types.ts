import type { SessionBrief } from "../schemas/index.js";
import type { StoredTask } from "../db/store.js";

export interface AdapterHealthSnapshot {
  available: boolean;
  version?: string;
  reason?: string;
}

export interface AttemptSpawnInput {
  taskId: string;
  attemptId: string;
  command: string;
  args: string[];
  cwd: string;
  logPath: string;
  timeoutMs?: number;
  captureStdout?: (chunk: string) => void;
}

export interface AdapterRunOutcome {
  cancelled: boolean;
  timedOut: boolean;
  exitCode: number | null;
}

export interface AttemptSpawner {
  spawn(input: AttemptSpawnInput): Promise<AdapterRunOutcome>;
}

export interface AdapterRunContext {
  task: StoredTask;
  sessionBrief: SessionBrief;
  attemptId: string;
  worktreePath: string;
  logPath: string;
  resultPath: string;
  spawn: AttemptSpawner;
}

export interface AdapterDoctorCheck {
  status: "pass" | "warn" | "fail";
  message: string;
}

export interface Adapter {
  readonly name: string;
  run(context: AdapterRunContext): Promise<AdapterRunOutcome>;
  health(): Promise<AdapterHealthSnapshot>;
  doctorCheck(health: AdapterHealthSnapshot): AdapterDoctorCheck;
}
