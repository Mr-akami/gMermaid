/** Put `window.gMermaidBootstrap = value` into a single-file page.
 *
 * The page is one inlined bundle, and that bundle's own code contains the
 * text `</head>` — inserting at the FIRST occurrence lands inside a script
 * and breaks the page. The real head end is the last one. */
export function injectBootstrap(html: string, value: unknown): string {
  const json = JSON.stringify(value).replaceAll("<", "\\u003c");
  const at = html.lastIndexOf("</head>");
  if (at === -1) throw new Error("Editor page has no </head>");
  return `${html.slice(0, at)}<script>window.gMermaidBootstrap=${json}</script>${html.slice(at)}`;
}
