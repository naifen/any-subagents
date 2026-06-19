import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Session } from "../schemas/index.js";
import type { AppConfig } from "../config/schema.js";
import type { RuntimePaths } from "../storage/paths.js";
import type { Store } from "../db/store.js";
import { forAudience } from "./audience.js";
import { readLogPreview } from "./log-preview.js";
import { buildSessionDigest } from "./session-digest.js";

export interface SessionExportDeps {
  store: Store;
  config: AppConfig;
  paths: RuntimePaths;
}

export interface SessionExportResult {
  output_dir: string;
  files: string[];
  skipped_logs: string[];
}

export const exportSessionBundle = async (
  session: Session,
  outputDir: string,
  deps: SessionExportDeps
): Promise<SessionExportResult> => {
  const exportDir = path.join(outputDir, session.session_id);
  await mkdir(exportDir, { recursive: true });
  const files: string[] = [];
  const skippedLogs: string[] = [];
  const includeLogs = deps.config.export?.include_logs ?? true;
  const includeArtifacts = deps.config.export?.include_artifacts ?? true;
  const includeMarkdown = deps.config.export?.include_markdown ?? true;

  const writeJson = async (filename: string, data: unknown): Promise<void> => {
    const filePath = path.join(exportDir, filename);
    await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`);
    files.push(filePath);
  };

  await writeJson("session.json", session);

  const tasks = deps.store.listTasks({ session_id: session.session_id });
  await writeJson("tasks.json", tasks);
  await writeJson("events.json", deps.store.listEvents({ session_id: session.session_id }));
  await writeJson("metrics.json", deps.store.queryMetrics({ session_id: session.session_id, limit: 10_000 }));

  if (includeArtifacts) {
    const artifacts = deps.store.listArtifacts({ session_id: session.session_id }).map((artifact) => forAudience.artifact(artifact, "public"));
    await writeJson("artifacts.json", artifacts);
  }

  if (includeMarkdown) {
    const digest = buildSessionDigest(deps.store, session.session_id);
    const markdown = `# Session Export\n\n- Session: ${session.session_id}\n- Repo: ${session.repo}\n- Base ref: ${session.base_ref}\n\n## Summary\n\n${JSON.stringify(digest.summary, null, 2)}\n`;
    const markdownPath = path.join(exportDir, "summary.md");
    await writeFile(markdownPath, markdown);
    files.push(markdownPath);
  }

  if (includeLogs) {
    const logsDir = path.join(exportDir, "logs");
    await mkdir(logsDir, { recursive: true });
    const logResults = await Promise.allSettled(
      tasks.map(async (task) => {
        const attempt = deps.store.getLatestAttemptForTask(task.task_id);
        if (!attempt?.log_path) {
          return null;
        }
        const { preview } = await readLogPreview(attempt.log_path, deps.config, 1_048_576, deps.paths);
        const logPath = path.join(logsDir, `${task.task_id}.log.txt`);
        await writeFile(logPath, preview);
        return logPath;
      })
    );
    for (let index = 0; index < logResults.length; index++) {
      const result = logResults[index];
      const task = tasks[index];
      if (!result || !task) continue;
      if (result.status === "fulfilled" && result.value) {
        files.push(result.value);
      } else if (result.status === "rejected") {
        skippedLogs.push(task.task_id);
      }
    }
  }

  return { output_dir: exportDir, files, skipped_logs: skippedLogs };
};
