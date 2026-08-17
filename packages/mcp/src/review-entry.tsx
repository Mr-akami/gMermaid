import { StrictMode, useCallback, useState } from "react";
import { createRoot } from "react-dom/client";
import { App as McpApp } from "@modelcontextprotocol/ext-apps";
import { useApp } from "@modelcontextprotocol/ext-apps/react";
import { ReviewApp, type DiagramKind } from "@gmermaid/app/review";
import "@gmermaid/app/style.css";

interface Bootstrap {
  readonly mode?: "browser" | undefined;
  readonly sessionId: string;
  readonly kind: DiagramKind;
  readonly mermaid: string;
  readonly title?: string | undefined;
  readonly token?: string | undefined;
}

declare global {
  interface Window {
    gMermaidBootstrap?: Bootstrap;
  }
}

function resultError(result: { isError?: boolean | undefined; content?: unknown }): Error | undefined {
  if (!result.isError) return undefined;
  const content = Array.isArray(result.content) ? result.content : [];
  const text = content.find((item): item is { type: "text"; text: string } => {
    return typeof item === "object" && item !== null && "type" in item && item.type === "text" && "text" in item;
  });
  return new Error(text?.text ?? "The MCP server rejected the review");
}

function EmbeddedReview() {
  const [bootstrap, setBootstrap] = useState<Bootstrap | undefined>(undefined);
  const onAppCreated = useCallback((app: McpApp) => {
    app.ontoolresult = (result) => {
      const value = result.structuredContent as Partial<Bootstrap> | undefined;
      if (
        typeof value?.sessionId === "string" &&
        (value.kind === "flowchart" || value.kind === "sequence" || value.kind === "class" || value.kind === "state") &&
        typeof value.mermaid === "string"
      ) {
        setBootstrap(value as Bootstrap);
      }
    };
  }, []);
  const { app, isConnected, error } = useApp({
    appInfo: { name: "gMermaid review", version: "0.1.0" },
    capabilities: {},
    onAppCreated,
  });

  if (error !== null) return <div className="canvas-error">MCP Apps connection failed: {error.message}</div>;
  if (!isConnected || app === null || bootstrap === undefined) return <div className="canvas-error">Editor を準備しています…</div>;

  return (
    <ReviewApp
      {...bootstrap}
      onSubmit={async (mermaid) => {
        const result = await app.callServerTool({
          name: "submit_mermaid_review",
          arguments: { sessionId: bootstrap.sessionId, mermaid },
        });
        const failure = resultError(result);
        if (failure !== undefined) throw failure;

        const capabilities = app.getHostCapabilities();
        if (capabilities?.updateModelContext !== undefined) {
          await app.updateModelContext({
            content: [
              {
                type: "text",
                text: `The user confirmed this Mermaid diagram in gMermaid (session ${bootstrap.sessionId}):\n\n\`\`\`mermaid\n${mermaid}\n\`\`\``,
              },
            ],
          });
        }
        if (capabilities?.message !== undefined) {
          const sent = await app.sendMessage({
            role: "user",
            content: [
              {
                type: "text",
                text: `Mermaid review ${bootstrap.sessionId} is confirmed. Use the confirmed diagram above, or call get_mermaid_review with this session ID.`,
              },
            ],
          });
          if (sent.isError) throw new Error("The host could not send the confirmation to the conversation");
        }
      }}
    />
  );
}

function BrowserReview({ bootstrap }: { readonly bootstrap: Bootstrap }) {
  return (
    <ReviewApp
      {...bootstrap}
      onSubmit={async (mermaid) => {
        const response = await fetch(window.location.href, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ mermaid }),
        });
        const body = (await response.json()) as { error?: string };
        if (!response.ok) throw new Error(body.error ?? `Submission failed (${response.status})`);
      }}
    />
  );
}

const bootstrap = window.gMermaidBootstrap;
createRoot(document.getElementById("root")!).render(
  <StrictMode>{bootstrap?.mode === "browser" ? <BrowserReview bootstrap={bootstrap} /> : <EmbeddedReview />}</StrictMode>,
);
