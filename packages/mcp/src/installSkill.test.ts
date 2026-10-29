import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { installSkill } from "./installSkill";

const SOURCE = join(import.meta.dirname, "..", "skill", "gmermaid", "SKILL.md");
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("installSkill", () => {
  it("installs, leaves an identical copy alone, and replaces an old one", () => {
    const root = mkdtempSync(join(tmpdir(), "gmermaid-skill-"));
    dirs.push(root);
    const first = installSkill(SOURCE, { kind: "dir", path: root });
    expect(first).toEqual({ path: join(root, "gmermaid", "SKILL.md"), status: "installed" });
    expect(installSkill(SOURCE, { kind: "dir", path: root }).status).toBe("unchanged");
    writeFileSync(first.path, "old");
    expect(installSkill(SOURCE, { kind: "dir", path: root }).status).toBe("updated");
    expect(readFileSync(first.path, "utf8")).toBe(readFileSync(SOURCE, "utf8"));
  });

  it("ships a skill whose frontmatter names it", () => {
    expect(readFileSync(SOURCE, "utf8")).toMatch(/^---\nname: gmermaid\ndescription: .+\n---\n/);
  });
});
