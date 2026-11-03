import { expect, test, type Locator } from "@playwright/test";
import { clickPathMiddle, codeText, element, expectCode, mermaidVerdict, openEditor, setCode } from "./helpers";

/** A canvas element by the text it shows. GUI-created elements carry a
 * generated `data-element-id`, so only parsed diagrams can be looked up by
 * name — everything the toolbar adds has to be found by its label. */
const node = (editor: Locator, text: string) =>
  editor.locator("svg g[data-element-id]").filter({ hasText: text }).first();

// The docs' opening example (mermaid.js.org/syntax/architecture.html), plus a
// junction, a nested group, an edge title and the `{group}` modifier.
const DOCS_SAMPLE = `architecture-beta
    group api(cloud)[API]
    group vpc[Private network] in api

    service db(database)[Database] in api
    service disk1(disk)[Storage] in vpc
    service server(server)[Server] in vpc
    service gateway(internet)[Gateway]
    junction fork

    db:L -- R:server
    disk1:T -- B:server
    server:R -[reads]-> L:fork
    fork:R <-- L:gateway
    gateway{group}:T -- B:db{group}
`;

test("typing the docs' sample into the code pane renders every element", async ({ page }) => {
  const editor = await openEditor(page, "Architecture");
  await setCode(editor, DOCS_SAMPLE);

  // 4 services + 1 junction are draggable nodes
  await expect(editor.locator("svg g[data-drag='connect']")).toHaveCount(5);
  // …plus 2 group frames and 5 edges
  await expect(editor.locator("svg [data-element-id]")).toHaveCount(12);
  await expect(element(editor, "db")).toContainText("Database");
  await expect(element(editor, "vpc")).toContainText("Private network");
  await expect(element(editor, "edge-3")).toContainText("reads");
  // an arrow at each requested end only: `-[reads]->` has one, `--` none
  await expect(element(editor, "edge-3").locator("path[marker-end]")).toHaveCount(1);
  await expect(element(editor, "edge-3").locator("path[marker-start]")).toHaveCount(0);
  await expect(element(editor, "edge-4").locator("path[marker-start]")).toHaveCount(1);
  await expect(element(editor, "edge-1").locator("path[marker-end], path[marker-start]")).toHaveCount(0);

  // the canvas text is mermaid-valid too
  await expect(mermaidVerdict(editor, "ok")).toBeVisible({ timeout: 15_000 });
});

test("port sides decide where the neighbour is drawn", async ({ page }) => {
  const editor = await openEditor(page, "Architecture");
  await setCode(
    editor,
    `architecture-beta
  service a(server)[A]
  service b(server)[B]
  service c(server)[C]
  service d(server)[D]
  a:R -- L:b
  a:B -- T:c
  b:B -- R:d
`,
  );
  const box = async (id: string) => (await element(editor, id).locator("rect").first().boundingBox())!;
  await expect(element(editor, "d")).toBeVisible();
  const [a, b, c, d] = [await box("a"), await box("b"), await box("c"), await box("d")];
  // a:R -- L:b → b to the right of a, on the same row
  expect(b.x).toBeGreaterThan(a.x + a.width);
  expect(Math.abs(b.y - a.y)).toBeLessThan(2);
  // a:B -- T:c → c below a, in the same column
  expect(c.y).toBeGreaterThan(a.y + a.height);
  expect(Math.abs(c.x - a.x)).toBeLessThan(2);
  // b:B -- R:d → d below b and to its LEFT (b's bottom port, d's right port)
  expect(d.y).toBeGreaterThan(b.y + b.height);
  expect(d.x + d.width).toBeLessThanOrEqual(b.x + b.width + 2);
});

test("the toolbar and property windows update the code text", async ({ page }) => {
  const editor = await openEditor(page, "Architecture");
  const props = editor.locator(".property-window");
  await setCode(editor, "architecture-beta\n");

  await editor.getByRole("button", { name: "+ Group" }).click();
  await expect(props.getByRole("heading", { name: "Group" })).toBeVisible();
  await props.getByLabel("Name", { exact: true }).fill("guigroup");
  await props.getByLabel("Label").fill("GUI group");
  await props.getByLabel("Icon", { exact: true }).selectOption("internet");
  await expectCode(editor).toContain('group guigroup(internet)["GUI group"]');

  // a service made while a group is selected lands inside it
  await editor.getByRole("button", { name: "+ Service" }).click();
  await expect(props.getByRole("heading", { name: "Service" })).toBeVisible();
  await props.getByLabel("Name", { exact: true }).fill("guisvc");
  await props.getByLabel("Label").fill("GUI service");
  await props.getByLabel("Icon", { exact: true }).selectOption("database");
  await expectCode(editor).toContain('service guisvc(database)["GUI service"] in guigroup');

  // …and moves back out through the Group picker
  await props.getByLabel("Group", { exact: true }).selectOption({ label: "(top level)" });
  await expectCode(editor).not.toContain("in guigroup");
  await expectCode(editor).toContain('service guisvc(database)["GUI service"]');

  // a name mermaid cannot read is refused, and says why
  await props.getByLabel("Name", { exact: true }).fill("group");
  await expect(editor.getByText("`group` is a mermaid keyword")).toBeVisible();
  await expectCode(editor).toContain("service guisvc(");

  // a custom icon name from an icon pack
  await props.getByLabel("Icon", { exact: true }).selectOption("__custom");
  await props.getByLabel("Icon name").fill("logos:aws");
  await expectCode(editor).toContain('service guisvc(logos:aws)["GUI service"]');
});

test("connecting two nodes writes an edge whose sides, arrows and label are editable", async ({ page }) => {
  const editor = await openEditor(page, "Architecture");
  const props = editor.locator(".property-window");
  await setCode(editor, "architecture-beta\n  service left(server)[Left]\n  service right(server)[Right]\n  junction hub\n");

  await node(editor, "Left").click();
  await editor.getByRole("button", { name: "→ Edge from selected" }).click();
  await node(editor, "Right").click();
  await expect(props.getByRole("heading", { name: "Edge" })).toBeVisible();
  // the new edge leaves by the sides that face each other on screen
  await expectCode(editor).toContain("left:R --> L:right");

  await props.getByLabel("Source side").selectOption("B");
  await props.getByLabel("Target side").selectOption("T");
  await expectCode(editor).toContain("left:B --> T:right");

  await props.getByLabel("Arrow at target").uncheck();
  await props.getByLabel("Arrow at source").check();
  await expectCode(editor).toContain("left:B <-- T:right");

  await props.getByLabel("Label").fill("syncs");
  await expectCode(editor).toContain('left:B <-["syncs"]- T:right');

  // the layout follows the sides: right is now BELOW left
  const l = (await node(editor, "Left").boundingBox())!;
  const r = (await node(editor, "Right").boundingBox())!;
  expect(r.y).toBeGreaterThan(l.y + l.height - 1);

  // re-point the target at the junction; a swap exchanges ends, sides and arrows
  await props.getByLabel("To", { exact: true }).selectOption({ label: "hub" });
  await expectCode(editor).toContain("left:B <-[\"syncs\"]- T:hub");
  await props.getByRole("button", { name: "⇄ Swap ends" }).click();
  await expectCode(editor).toContain('hub:T -["syncs"]-> B:left');

  // an edge cannot end on itself
  await props.getByLabel("To", { exact: true }).selectOption({ label: "hub" });
  await expect(editor.getByText("cannot connect a node to itself")).toBeVisible();
});

test("dragging from one service to another connects them", async ({ page }) => {
  const editor = await openEditor(page, "Architecture");
  const props = editor.locator(".property-window");
  await setCode(editor, "architecture-beta\n  service a(server)[A]\n  service b(server)[B]\n  service c(server)[C]\n  a:R -- L:b\n");

  const from = (await element(editor, "a").boundingBox())!;
  const to = (await element(editor, "c").boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
  await page.mouse.up();

  await expect(props.getByRole("heading", { name: "Edge" })).toBeVisible();
  await expectCode(editor).toMatch(/a:[RLTB] --> [RLTB]:c/);
});

test("a `{group}` edge is offered only where it crosses a group border", async ({ page }) => {
  const editor = await openEditor(page, "Architecture");
  const props = editor.locator(".property-window");
  await setCode(
    editor,
    `architecture-beta
  group g1[One]
  group g2[Two]
  service a(server)[A] in g1
  service b(server)[B] in g2
  service c(server)[C] in g1
  a:R -- L:b
  a:B -- T:c
`,
  );

  await clickPathMiddle(page, editor, "edge-1");
  await expect(props.getByLabel("Source on group border")).toBeEnabled();
  await props.getByLabel("Source on group border").check();
  await props.getByLabel("Target on group border").check();
  await expectCode(editor).toContain("a{group}:R -- L:b{group}");

  // a and c share a group: mermaid refuses the flag there, so it is off
  await clickPathMiddle(page, editor, "edge-2");
  await expect(props.getByLabel("Source on group border")).toBeDisabled();
});

test("deleting a group keeps its members", async ({ page }) => {
  const editor = await openEditor(page, "Architecture");
  await setCode(editor, "architecture-beta\n  group g[Frame]\n  service a(server)[A] in g\n");
  // only the frame's border and title take clicks
  await element(editor, "g").locator("text").first().click();
  await editor.getByRole("button", { name: "Delete", exact: true }).click();
  await expectCode(editor).not.toContain("group g");
  await expectCode(editor).toContain('service a(server)["A"]');
});
