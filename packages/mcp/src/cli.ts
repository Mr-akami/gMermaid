import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { PassThrough } from "node:stream";
import { createGMermaidServer } from "./server";

const instance = createGMermaidServer();
const keepAlive = setInterval(() => {}, 60 * 60_000);

async function shutdown(): Promise<void> {
  clearInterval(keepAlive);
  await instance.close();
  process.exit(0);
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

try {
  // A PassThrough normalizes piped stdin across Node versions and npx/client
  // launchers; direct process streams can otherwise miss/buffer early bytes.
  const input = new PassThrough();
  const output = new PassThrough();
  process.stdin.pipe(input);
  output.pipe(process.stdout);
  await instance.server.connect(new StdioServerTransport(input, output));
} catch (cause) {
  console.error("gMermaid MCP server failed:", cause);
  process.exit(1);
}
