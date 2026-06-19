import { mkdir } from "node:fs/promises";
import { loadConfig } from "../config/load.js";
import { createControlPlane, type ControlPlane } from "./control-plane.js";
import type { ResultAudience } from "./audience.js";
import { defaultRuntimePaths, type RuntimePaths } from "../storage/paths.js";

export const createBootstrappedControlPlane = async (
  paths: RuntimePaths = defaultRuntimePaths(),
  options: { audience?: ResultAudience } = {}
): Promise<ControlPlane> => {
  const config = await loadConfig();
  await Promise.all([
    mkdir(paths.stateDir, { recursive: true }),
    mkdir(paths.logsDir, { recursive: true }),
    mkdir(paths.artifactsDir, { recursive: true }),
    mkdir(paths.worktreeRoot, { recursive: true }),
    mkdir(paths.runtimeDir, { recursive: true })
  ]);
  const plane = createControlPlane({ paths, config, ...(options.audience ? { audience: options.audience } : {}) });
  return plane;
};
