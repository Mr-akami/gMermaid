import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

interface PackageMetadata {
  readonly version: string;
}

let cached: PackageMetadata | undefined;

export function packageVersion(): string {
  cached ??= JSON.parse(
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"), "utf8"),
  ) as PackageMetadata;
  return cached.version;
}
