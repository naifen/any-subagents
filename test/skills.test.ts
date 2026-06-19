import { mkdtemp, readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { mountSkillPaths } from "../src/core/skills.js";
import { writeHarnessFiles } from "../src/core/harness.js";
import type { TaskEnvelope } from "../src/schemas/index.js";

let tempDir: string;

afterEach(async () => {
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

describe("skills", () => {
  test("mounts allowlisted skill paths read-only via symlink", async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "skills-test-"));
    const skillRoot = path.join(tempDir, "external-skill");
    await mkdir(skillRoot, { recursive: true });
    await writeFile(path.join(skillRoot, "SKILL.md"), "# Demo skill\n");

    const worktree = path.join(tempDir, "worktree");
    await mkdir(worktree, { recursive: true });
    const mounted = await mountSkillPaths({
      skillPaths: [skillRoot],
      allowlist: [tempDir],
      mountMode: "symlink",
      worktreePath: worktree
    });
    expect(mounted).toHaveLength(1);
    await expect(readFile(path.join(mounted[0]!, "SKILL.md"), "utf8")).resolves.toContain("Demo skill");
  });

  test("harness instructions mention verification commands and anti-recursion", async () => {
    tempDir = await mkdtemp(path.join(tmpdir(), "harness-skills-"));
    const harnessDir = path.join(tempDir, ".any-subagents");
    const envelope: TaskEnvelope = {
      schema_version: "1",
      task_id: "task_test",
      session_id: "sess_test",
      group_id: "grp_test",
      mode: "verify",
      goal: "Run checks.",
      adapter: "fake",
      profile: "default",
      success_criteria: ["Checks pass."],
      verification_commands: ["pnpm test"],
      metadata: {}
    };
    await writeHarnessFiles({
      harnessDir,
      envelope,
      brief: { goal: "g", constraints: [], decisions: [], accepted_findings: [], rejected_paths: [], open_questions: [] },
      attemptId: "att_test",
      verificationCommands: envelope.verification_commands,
      mountedSkills: ["/tmp/skills/demo"]
    });
    const instructions = await readFile(path.join(harnessDir, "instructions.md"), "utf8");
    expect(instructions).toContain("Do not spawn subagents");
    expect(instructions).toContain("pnpm test");
    expect(instructions).toContain("Mounted skill paths");
  });
});
