import { cp, mkdir, symlink } from "node:fs/promises";
import path from "node:path";
import { existsSync } from "node:fs";
import { createHash } from "node:crypto";

export interface SkillMountOptions {
  skillPaths: string[];
  allowlist: string[];
  mountMode: "symlink" | "copy";
  worktreePath: string;
}

export const mountSkillPaths = async (options: SkillMountOptions): Promise<string[]> => {
  const mounted: string[] = [];
  const usedNames = new Set<string>();
  const skillsRoot = path.join(options.worktreePath, ".any-subagents", "skills");
  await mkdir(skillsRoot, { recursive: true });

  for (const skillPath of options.skillPaths) {
    const resolved = path.resolve(skillPath);
    if (!existsSync(resolved)) continue;
    if (options.allowlist.length > 0 && !options.allowlist.some((allowed) => resolved.startsWith(path.resolve(allowed)))) {
      continue;
    }
    // Disambiguate distinct skill paths that share a basename to avoid EEXIST collisions.
    const baseName = path.basename(resolved);
    const name = usedNames.has(baseName)
      ? `${baseName}-${createHash("sha1").update(resolved).digest("hex").slice(0, 8)}`
      : baseName;
    usedNames.add(name);
    const target = path.join(skillsRoot, name);
    if (options.mountMode === "copy") {
      await cp(resolved, target, { recursive: true });
    } else {
      await symlink(resolved, target, "dir");
    }
    mounted.push(target);
  }

  return mounted;
};
