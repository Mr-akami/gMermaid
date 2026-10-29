import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { packageVersion } from "./metadata";
import { createGMermaidServer } from "./server";
import { StandaloneEditorServer } from "./standalone";
import { extractBlocks, formatReports, hasErrors, validateBlock } from "./validate";

const DIST_DIR = dirname(fileURLToPath(import.meta.url));

function help(): string {
  return `gMermaid ${packageVersion()}

Usage:
  gmermaid                     Open the local Mermaid editor
  gmermaid editor              Open the local Mermaid editor
  gmermaid validate <file|->…  Check Mermaid files (.mmd, or the mermaid
                               blocks of a .md); exit 1 on any error
  gmermaid mcp                 Run the MCP STDIO server
  gmermaid --help              Show this help
  gmermaid --version           Show the version
`;
}

/** A usage mistake: printed with a pointer to --help, exit 2. */
class UsageError extends Error {}

function noArgs(command: string, args: readonly string[]): void {
  if (args.length > 0) throw new UsageError(`${command}: unexpected arguments: ${args.join(" ")}`);
}

async function runEditor(): Promise<void> {
  const server = new StandaloneEditorServer(readFileSync(join(DIST_DIR, "editor.html"), "utf8"));
  const url = await server.open();
  console.error(`gMermaid is running at ${url}`);
  console.error("Press Ctrl+C to stop.");
  const shutdown = () => {
    server.close();
    process.exit(0);
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

async function runMcp(): Promise<void> {
  const instance = createGMermaidServer();
  const keepAlive = setInterval(() => {}, 60 * 60_000);
  async function shutdown(): Promise<void> {
    clearInterval(keepAlive);
    await instance.close();
    process.exit(0);
  }
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());

  const input = new PassThrough();
  const output = new PassThrough();
  process.stdin.pipe(input);
  output.pipe(process.stdout);
  await instance.server.connect(new StdioServerTransport(input, output));
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

async function runValidate(files: readonly string[]): Promise<number> {
  if (files.length === 0) throw new UsageError("validate: give at least one file, or - for stdin");
  let failed = false;
  for (const file of files) {
    let text: string;
    try {
      text = file === "-" ? await readStdin() : readFileSync(file, "utf8");
    } catch (cause) {
      console.log(`${file}: error: ${cause instanceof Error ? cause.message : String(cause)}`);
      failed = true;
      continue;
    }
    const reports = extractBlocks(file, text).map(validateBlock);
    for (const line of formatReports(file, reports)) console.log(line);
    failed ||= hasErrors(reports);
  }
  return failed ? 1 : 0;
}

const [command, ...rest] = process.argv.slice(2);

try {
  if (command === "--help" || command === "-h" || command === "help") {
    noArgs(command, rest);
    process.stdout.write(help());
  } else if (command === "--version" || command === "-v") {
    noArgs(command, rest);
    process.stdout.write(`${packageVersion()}\n`);
  } else if (command === "mcp") {
    noArgs(command, rest);
    await runMcp();
  } else if (command === "validate") {
    process.exitCode = await runValidate(rest);
  } else if (command === undefined || command === "editor") {
    noArgs(command ?? "editor", rest);
    await runEditor();
  } else {
    throw new UsageError(`Unknown command: ${command}`);
  }
} catch (cause) {
  if (cause instanceof UsageError) {
    console.error(`${cause.message}\n\n${help()}`);
    process.exit(2);
  }
  console.error(cause instanceof Error ? cause.message : String(cause));
  process.exit(1);
}
