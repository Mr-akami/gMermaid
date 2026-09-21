import { expect, test } from "@playwright/test";
import { element, expectCode, openEditor, setCode } from "./helpers";

// Everything the sequence editor used to drop on import: activation (both
// spellings), a participant box, a `rect` band, create/destroy and a typed
// participant — plus a `<br/>` label.
const DEEP_SAMPLE = `sequenceDiagram
  actor user as User
  box rgb(226,236,250) Back end
    participant api as API
    participant db@{ "type": "database" } as Store
  end
  user->>+api: login<br/>with SSO
  rect rgba(0, 0, 255, .1)
    api->>db: read
  end
  create participant w as Worker
  api->>w: work
  destroy w
  api-->>-user: token
`;

const head = (editor: ReturnType<typeof element>) => editor.locator("rect, ellipse, path").first();

test("activation, box, rect, create/destroy and a typed participant survive the round trip", async ({ page }) => {
  const editor = await openEditor(page, "Sequence");
  await setCode(editor, DEEP_SAMPLE);

  // 4 lifelines + 1 box + 4 messages + 1 rect fragment
  await expect(editor.locator("svg [data-element-id]")).toHaveCount(10);
  await expect(element(editor, "box-1")).toBeVisible();
  await expect(element(editor, "db")).toHaveAttribute("data-kind", "database");
  await expect(element(editor, "user")).toHaveAttribute("data-kind", "actor");
  // one activation bar (api, opened by `+` and closed by `-`)
  await expect(editor.locator("svg [data-activation]")).toHaveCount(1);
  // the destroyed worker's spine ends in a cross
  await expect(editor.locator("svg [data-destroy]")).toHaveCount(1);
  await expect(editor.locator("svg [data-rect-fill]")).toHaveCount(1);
  // the `<br/>` label renders as two tspan lines
  await expect(editor.locator("svg text tspan", { hasText: "with SSO" })).toHaveCount(1);

  await expectCode(editor).toContain("user->>+api: login<br/>with SSO");
  await expectCode(editor).toContain("api-->>-user: token");
  await expectCode(editor).toContain("box rgb(226,236,250) Back end");
  await expectCode(editor).toContain('participant db@{ "type": "database" } as Store');
  await expectCode(editor).toContain("rect rgba(0, 0, 255, .1)");
  await expectCode(editor).toContain("create participant w as Worker");
  await expectCode(editor).toContain("destroy w");
});

test("the property window toggles a message's activation and a participant type", async ({ page }) => {
  const editor = await openEditor(page, "Sequence");
  await setCode(editor, `sequenceDiagram\n  participant a\n  participant b\n  a->>b: call\n  b-->>a: reply\n`);

  await element(editor, "message-1").locator("path").first().click({ force: true });
  await expect(editor.getByRole("heading", { name: "Message" })).toBeVisible();
  await editor.getByLabel("Activation").selectOption("start");
  await expectCode(editor).toContain("a->>+b: call");
  await expect(editor.locator("svg [data-activation]")).toHaveCount(1);

  await element(editor, "message-2").locator("path").first().click({ force: true });
  await editor.getByLabel("Activation").selectOption("end");
  await expectCode(editor).toContain("b-->>-a: reply");

  await head(element(editor, "b")).click();
  await expect(editor.getByRole("heading", { name: "Lifeline" })).toBeVisible();
  await editor.getByLabel("Type").selectOption("database");
  await expectCode(editor).toContain('participant b@{ "type": "database" }');
  await expect(element(editor, "b")).toHaveAttribute("data-kind", "database");
});

test("the property window puts a lifeline into a new box and wraps a message in a rect", async ({ page }) => {
  const editor = await openEditor(page, "Sequence");
  await setCode(editor, `sequenceDiagram\n  participant a\n  participant b\n  a->>b: call\n`);
  await expect(editor.locator("svg [data-element-id^='box-'], svg [data-element-id^='pbx_']")).toHaveCount(0);

  await head(element(editor, "b")).click();
  await editor.getByLabel("Box", { exact: true }).selectOption("new");
  await expectCode(editor).toMatch(/box Group\n\s+participant b\n\s+end/);
  // a box born in the GUI carries the generated `pbx_` prefix
  await expect(editor.locator("svg [data-element-id^='box-'], svg [data-element-id^='pbx_']")).toHaveCount(1);

  // a is put into the same box, which keeps both members contiguous
  await head(element(editor, "a")).click();
  const boxSelect = editor.getByLabel("Box", { exact: true });
  await boxSelect.selectOption({ label: "Group" });
  await expectCode(editor).toMatch(/box Group\n\s+participant b\n\s+participant a\n\s+end/);

  // renaming the box goes through the same window
  const name = editor.getByLabel("Box name");
  await name.fill("Team");
  await name.blur();
  await expectCode(editor).toContain("box Team");

  await element(editor, "message-1").locator("path").first().click({ force: true });
  await editor.getByRole("button", { name: "rect", exact: true }).click();
  await expectCode(editor).toContain("rect rgb(220,235,255)");
  await expect(editor.locator("svg [data-rect-fill]")).toHaveCount(1);
});

test("autonumber start and step fields reach the code", async ({ page }) => {
  const editor = await openEditor(page, "Sequence");
  await setCode(editor, `sequenceDiagram\n  participant a\n  participant b\n  a->>b: call\n`);

  await editor.getByLabel("autonumber").check();
  await expectCode(editor).toContain("autonumber");
  const start = editor.getByLabel("autonumber start");
  await start.fill("10");
  await start.blur();
  const step = editor.getByLabel("autonumber step");
  await step.fill("5");
  await step.blur();
  await expectCode(editor).toContain("autonumber 10 5");
  // numbering shows up on the rendered row
  await expect(editor.locator("svg text", { hasText: "10: call" })).toHaveCount(1);
});
