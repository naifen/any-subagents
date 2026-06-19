import type { SessionBrief, TaskEnvelope } from "../schemas/index.js";

export interface AdapterRunTask {
  task_id: string;
  envelope: TaskEnvelope;
}

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
  task: AdapterRunTask;
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
  /** Implementations must be stateless; getAdapter() returns a new instance on each call. */
  readonly name: string;
  run(context: AdapterRunContext): Promise<AdapterRunOutcome>;
  health(): Promise<AdapterHealthSnapshot>;
  doctorCheck(health: AdapterHealthSnapshot): AdapterDoctorCheck;
}
