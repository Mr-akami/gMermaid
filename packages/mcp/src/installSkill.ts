import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

// `gmermaid install-skill`: put the bundled agent skill where the agent looks
// for skills. Re-running it after an upgrade replaces the old copy.

export type SkillTarget = { readonly kind: "user" } | { readonly kind: "project" } | { readonly kind: "dir"; readonly path: string };

export function skillsRoot(target: SkillTarget): string {
  if (target.kind === "dir") return resolve(target.path);
  if (target.kind === "project") return resolve(".claude", "skills");
  return join(homedir(), ".claude", "skills");
}

export function installSkill(source: string, target: SkillTarget): { path: string; status: "installed" | "updated" | "unchanged" } {
  const text = readFileSync(source, "utf8");
  const dir = join(skillsRoot(target), "gmermaid");
  const path = join(dir, "SKILL.md");
  const before = existsSync(path) ? readFileSync(path, "utf8") : undefined;
  if (before === text) return { path, status: "unchanged" };
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, text);
  return { path, status: before === undefined ? "installed" : "updated" };
}
