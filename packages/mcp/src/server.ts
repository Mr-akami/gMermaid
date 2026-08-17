import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  getUiCapability,
  registerAppResource,
  registerAppTool,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import { BrowserReviewServer } from "./browser";
import { SessionStore, type ReviewResult } from "./session";
import { validateDiagram } from "./diagram";

const RESOURCE_URI = "ui://gmermaid/review.html";
const UI_PATH = join(dirname(fileURLToPath(import.meta.url)), "review.html");

const resultShape = {
  status: z.enum(["editing", "pending", "confirmed", "expired"]),
  sessionId: z.string().uuid(),
  kind: z.enum(["flowchart", "sequence", "class", "state"]).optional(),
  mermaid: z.string().optional(),
  changed: z.boolean().optional(),
  title: z.string().optional(),
  browserUrl: z.string().url().optional(),
};

function resultContent(result: ReviewResult): string {
  if (result.status === "confirmed") {
    return `The user confirmed this ${result.kind} Mermaid diagram:\n\n\`\`\`mermaid\n${result.mermaid}\n\`\`\``;
  }
  if (result.status === "expired") return `Mermaid review session ${result.sessionId} expired.`;
  return `Mermaid review ${result.sessionId} is still waiting for the user. Call get_mermaid_review again.`;
}

export interface GMermaidServer {
  readonly server: McpServer;
  close(): Promise<void>;
}

export function createGMermaidServer(): GMermaidServer {
  const html = readFileSync(UI_PATH, "utf8");
  const sessions = new SessionStore();
  const browser = new BrowserReviewServer(sessions, html);
  const server = new McpServer(
    { name: "gmermaid", version: "0.1.0" },
    {
      capabilities: { tools: {}, resources: {} },
      instructions:
        "Use review_mermaid when a user should visually inspect or edit Mermaid. If it returns editing/pending, keep calling get_mermaid_review with waitMs up to 30000 until confirmed or expired. The confirmed mermaid field is the user's authoritative result.",
    },
  );

  registerAppResource(
    server,
    "gMermaid review editor",
    RESOURCE_URI,
    {
      mimeType: RESOURCE_MIME_TYPE,
      _meta: {
        ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: [] } },
        "openai/widgetDescription": "GUI editor for reviewing and correcting a Mermaid diagram before returning it to the model.",
      },
    },
    async () => ({
      contents: [{ uri: RESOURCE_URI, mimeType: RESOURCE_MIME_TYPE, text: html }],
    }),
  );

  registerAppTool(
    server,
    "review_mermaid",
    {
      title: "Review Mermaid diagram",
      description:
        "Open a visual Mermaid editor so the user can inspect and correct a flowchart, sequence diagram, class diagram, or state diagram. Use the confirmed result as authoritative.",
      inputSchema: {
        mermaid: z.string().min(1).max(256 * 1024),
        title: z.string().max(120).optional(),
      },
      outputSchema: resultShape,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: false },
      _meta: {
        ui: { resourceUri: RESOURCE_URI, visibility: ["model", "app"] },
        "openai/outputTemplate": RESOURCE_URI,
        "openai/widgetAccessible": true,
        "openai/toolInvocation/invoking": "Opening Mermaid editor…",
        "openai/toolInvocation/invoked": "Mermaid editor ready",
      },
    },
    async ({ mermaid, title }) => {
      const validation = validateDiagram(mermaid);
      if (!validation.ok) throw new Error(validation.message);
      const session = sessions.create(validation.kind, mermaid, title);
      const capabilities = server.server.getClientCapabilities() as unknown as Parameters<typeof getUiCapability>[0];
      const ui = getUiCapability(capabilities);
      if (ui?.mimeTypes?.includes(RESOURCE_MIME_TYPE)) {
        const structuredContent = {
          status: "editing" as const,
          sessionId: session.id,
          kind: session.kind,
          mermaid: session.originalMermaid,
          ...(session.title === undefined ? {} : { title: session.title }),
        };
        return {
          structuredContent,
          content: [{ type: "text" as const, text: `Mermaid review ${session.id} is open in the editor.` }],
        };
      }

      const browserUrl = await browser.open(session.id);
      const waited = await sessions.wait(session.id, 30_000);
      if (waited.status === "confirmed") {
        return { structuredContent: waited, content: [{ type: "text" as const, text: resultContent(waited) }] };
      }
      return {
        structuredContent: {
          status: waited.status,
          sessionId: session.id,
          ...(waited.status === "pending" ? { kind: waited.kind } : {}),
          browserUrl,
        },
        content: [
          {
            type: "text" as const,
            text: `The editor opened at ${browserUrl}. The user is still editing. Call get_mermaid_review with sessionId ${session.id}.`,
          },
        ],
      };
    },
  );

  server.registerTool(
    "submit_mermaid_review",
    {
      title: "Submit Mermaid review",
      description: "Confirm a Mermaid edit from the review UI. This tool is for the app UI, not the model.",
      inputSchema: { sessionId: z.string().uuid(), mermaid: z.string().min(1).max(256 * 1024) },
      outputSchema: resultShape,
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false, idempotentHint: true },
      _meta: { ui: { visibility: ["app"] } },
    },
    async ({ sessionId, mermaid }) => {
      const session = sessions.getSession(sessionId);
      if (session === undefined) throw new Error("Unknown or expired review session");
      const validation = validateDiagram(mermaid, session.kind);
      if (!validation.ok) throw new Error(validation.message);
      const result = sessions.confirm(sessionId, mermaid);
      return { structuredContent: result, content: [{ type: "text" as const, text: resultContent(result) }] };
    },
  );

  server.registerTool(
    "get_mermaid_review",
    {
      title: "Get Mermaid review result",
      description:
        "Wait for and retrieve a Mermaid review. Repeat while status is pending. A confirmed result is the user's authoritative Mermaid diagram.",
      inputSchema: { sessionId: z.string().uuid(), waitMs: z.number().int().min(0).max(30_000).optional() },
      outputSchema: resultShape,
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false, idempotentHint: true },
      _meta: { ui: { visibility: ["model"] } },
    },
    async ({ sessionId, waitMs = 0 }) => {
      const result = await sessions.wait(sessionId, waitMs);
      return { structuredContent: result, content: [{ type: "text" as const, text: resultContent(result) }] };
    },
  );

  return {
    server,
    async close() {
      browser.close();
      await server.close();
    },
  };
}
