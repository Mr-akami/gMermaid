// The skill's one source is the Claude Code plugin at plugins/gmermaid (also
// what `npx skills add` reads). The npm package carries a copy for
// `gmermaid install-skill`, refreshed on every build.
import { cpSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const from = join(here, "..", "..", "..", "plugins", "gmermaid", "skills", "gmermaid");
const to = join(here, "..", "skill", "gmermaid");
rmSync(to, { recursive: true, force: true });
cpSync(from, to, { recursive: true });
