// Fake adapter script written to each task worktree as an .mjs file.
// Uses String.raw to avoid double-escape confusion: \n in the output file
// is a literal backslash-n that JavaScript interprets as a newline.
export const fakeAdapterScript = String.raw`
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const task = JSON.parse(await readFile(path.join(".any-subagents", "task.json"), "utf8"));
const attemptId = process.env.ANY_SUBAGENTS_ATTEMPT_ID;
const metadata = task.metadata ?? {};

if (metadata.fake_delay_ms) {
  await sleep(Number(metadata.fake_delay_ms));
}

if (metadata.fake_result === "malformed") {
  await writeFile(path.join(".any-subagents", "result.json"), "{");
  console.log("fake adapter wrote malformed result");
  process.exit(0);
}

const changes = [];
if (metadata.fake_change_file) {
  const target = String(metadata.fake_change_file);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, String(metadata.fake_change_content ?? "fake change\n"));
  changes.push({ path: target, summary: "Fake adapter wrote deterministic content." });
}

const status = metadata.fake_status ?? "completed";
const result = {
  schema_version: "1",
  task_id: task.task_id,
  attempt_id: attemptId,
  status,
  summary: status === "completed" ? "Fake adapter completed the task." : "Fake adapter reported " + status + ".",
  verification: [{ command: "fake-adapter", status: "passed", output: "fake adapter completed" }],
  artifacts: [],
  risks: [],
  proposed_brief_updates: [],
  ...(changes.length > 0 ? { changes, changed_files: changes.map((change) => change.path) } : { findings: [{ summary: "Fake adapter completed without file changes." }] })
};

await writeFile(path.join(".any-subagents", "result.tmp.json"), JSON.stringify(result, null, 2) + "\n");
await rename(path.join(".any-subagents", "result.tmp.json"), path.join(".any-subagents", "result.json"));
console.log("fake adapter completed");
`;
