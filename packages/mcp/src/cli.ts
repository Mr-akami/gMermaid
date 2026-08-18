import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import { packageVersion } from "./metadata";
import { createGMermaidServer } from "./server";
import { StandaloneEditorServer } from "./standalone";

const DIST_DIR = dirname(fileURLToPath(import.meta.url));

function help(): string {
  return `gMermaid ${packageVersion()}

Usage:
  gmermaid           Open the local Mermaid editor
  gmermaid editor    Open the local Mermaid editor
  gmermaid mcp       Run the MCP STDIO server
  gmermaid --help    Show this help
  gmermaid --version Show the version
`;
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

const [command, ...rest] = process.argv.slice(2);

try {
  if (rest.length > 0) throw new Error(`Unexpected arguments: ${rest.join(" ")}`);
  if (command === "--help" || command === "-h" || command === "help") {
    process.stdout.write(help());
  } else if (command === "--version" || command === "-v") {
    process.stdout.write(`${packageVersion()}\n`);
  } else if (command === "mcp") {
    await runMcp();
  } else if (command === undefined || command === "editor") {
    await runEditor();
  } else {
    throw new Error(`Unknown command: ${command}\n\n${help()}`);
  }
} catch (cause) {
  console.error(cause instanceof Error ? cause.message : String(cause));
  process.exit(1);
}
