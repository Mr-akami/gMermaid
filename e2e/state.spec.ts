import { expect, test } from "@playwright/test";
import { clickPathMiddle, element, expectCode, openEditor, setCode } from "./helpers";

// Concurrency regions, a per-block direction, a multi-line note and a
// self-transition — the four things the docs show that the editor used to drop.
const DEEP_SAMPLE = `stateDiagram-v2
  [*] --> Active
  state Active {
    direction LR
    [*] --> NumLockOff
    NumLockOff --> NumLockOn : EvNumLockPressed
    --
    [*] --> CapsLockOff
    CapsLockOff --> [*]
  }
  Active --> Active : poll
  note right of Active
    two keyboards
    one state
  end note
`;

/** The composite's own hit target is its border + title bar; the title text
 * is the one spot a click cannot miss. */
const compositeTitle = (editor: ReturnType<typeof element>) => editor.locator("text");

test("pasted regions, block direction, multi-line note and self-transition survive the round trip", async ({ page }) => {
  const editor = await openEditor(page, "State");
  await setCode(editor, DEEP_SAMPLE);

  // 8 states (1 composite + 4 leaves + 3 [*]) + 6 transitions + 1 note
  await expect(editor.locator("svg [data-element-id]")).toHaveCount(15);
  await expect(element(editor, "Active")).toBeVisible();
  await expect(element(editor, "state_start_Active_r1")).toBeVisible();
  // one dashed `--` divider between the two regions
  await expect(editor.locator("svg [data-region-separator]")).toHaveCount(1);
  // the note is drawn as one tspan per line
  await expect(editor.locator("svg text tspan", { hasText: "two keyboards" })).toHaveCount(1);
  await expect(editor.locator("svg text tspan", { hasText: "one state" })).toHaveCount(1);

  await expectCode(editor).toContain("direction LR");
  await expectCode(editor).toContain("--");
  await expectCode(editor).toContain("Active --> Active : poll");
  await expectCode(editor).toContain("end note");
  // regions come back as two groups separated by `--`
  await expectCode(editor).toMatch(/--[\s\S]*CapsLockOff/);
});

test("+ Region splits the selected composite into two regions", async ({ page }) => {
  const editor = await openEditor(page, "State");
  await setCode(
    editor,
    `stateDiagram-v2
  state Moving {
    [*] --> Slow
    Slow --> Fast : accelerate
  }
`,
  );
  await expect(editor.locator("svg [data-region-separator]")).toHaveCount(0);

  // selecting the composite and adding a region moves its last member into a
  // fresh one (mermaid cannot express an EMPTY region)
  await compositeTitle(element(editor, "Moving")).click();
  await expect(editor.getByRole("heading", { name: "State" })).toBeVisible();
  await editor.getByRole("button", { name: "+ Region" }).click();

  await expectCode(editor).toContain("--");
  await expect(editor.locator("svg [data-region-separator]")).toHaveCount(1);
  // the moved state reports its new region in the property window
  await expect(editor.getByLabel("Region")).toHaveValue("1");
});

test("the property window sets a per-block direction and edits a note across lines", async ({ page }) => {
  const editor = await openEditor(page, "State");
  await setCode(
    editor,
    `stateDiagram-v2
  state Moving {
    [*] --> Slow
  }
  note right of Moving : check
`,
  );

  await compositeTitle(element(editor, "Moving")).click();
  await editor.getByLabel("Block direction").selectOption("LR");
  await expectCode(editor).toContain("direction LR");

  // a newline in the textarea switches codegen to the `end note` block form
  await editor.locator("svg [data-element-id^='note-']").first().click();
  const text = editor.getByLabel("Note text");
  await expect(text).toHaveValue("check");
  await text.fill("check\nthe brakes");
  await text.blur();

  await expectCode(editor).toContain("end note");
  await expectCode(editor).toContain("the brakes");
  await expectCode(editor).not.toContain("note right of Moving : check");
});

test("move mode drags a state into a composite frame", async ({ page }) => {
  const editor = await openEditor(page, "State");
  await setCode(
    editor,
    `stateDiagram-v2
  state Moving {
    state Slow
  }
  state Outside
`,
  );
  await expectCode(editor).toContain("state Outside");

  await editor.getByRole("button", { name: "⇱ Move mode" }).click();
  await expect(editor.getByText("drag a state onto a composite frame")).toBeVisible();

  const from = (await element(editor, "Outside").locator("rect").first().boundingBox())!;
  const to = (await element(editor, "Slow").locator("rect").first().boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 });
  await page.mouse.up();

  // Outside now lives inside the composite block
  await expectCode(editor).toMatch(/state Moving \{[\s\S]*state Outside[\s\S]*\}/);
});

// A composite IS a state with children, so the GUI needs a way to put the
// first child in; and `[*]` is scoped per container, so each composite may
// have its own pair.
test("a plain state becomes a composite, and each container takes its own [*]", async ({ page }) => {
  const editor = await openEditor(page, "State");
  await setCode(editor, "stateDiagram-v2\n  [*] --> A\n  A --> B\n");
  await expectCode(editor).toContain("A --> B");

  await element(editor, "A").click();
  await editor.getByRole("button", { name: "+ Child state" }).click();
  await expectCode(editor).toMatch(/state A \{[\s\S]*NewState1/);

  // the child is selected, so its container takes the new markers
  const before = await editor.locator("svg [data-element-id]").count();
  await editor.getByRole("button", { name: "+ Start [*]" }).click();
  await editor.getByRole("button", { name: "+ End [*]" }).click();
  await expect(editor.locator("svg [data-element-id]")).toHaveCount(before + 2);

  // the top level already had a start, so asking again there is refused
  await element(editor, "B").click();
  await expect(editor.getByRole("button", { name: "+ Start [*]" })).toHaveAttribute(
    "title",
    /already has a start/,
  );
});

test("+ Child state is refused for a pseudo-state", async ({ page }) => {
  const editor = await openEditor(page, "State");
  await setCode(editor, "stateDiagram-v2\n  [*] --> A\n");
  await expectCode(editor).toContain("--> A");
  await element(editor, "state_start").click();
  await expect(editor.getByRole("button", { name: "+ Child state" })).toBeDisabled();
});

// dagre never sees a self-transition, so its label used to be dropped at a
// fixed offset — straight onto the note that sits on that same side.
test("a self-transition label keeps clear of the note beside its state", async ({ page }) => {
  const editor = await openEditor(page, "State");
  await setCode(
    editor,
    `stateDiagram-v2
  [*] --> Idle
  Idle --> Idle : retry the whole thing
  Idle --> Running : a fairly long trigger
  note right of Idle : a note about idling
`,
  );
  const label = editor.locator("svg text", { hasText: "retry the whole thing" }).first();
  await expect(label).toBeVisible();
  const note = element(editor, "note-1").locator("rect");
  const a = (await label.boundingBox())!;
  const b = (await note.boundingBox())!;
  expect(a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height).toBe(false);
});

// The user's original report: selecting a transition showed only its label,
// so the two states it joins — the one thing that identifies it — were
// invisible, and re-pointing it meant deleting it and drawing a new one.
test("a transition names its ends, re-points one and reverses in one action", async ({ page }) => {
  const editor = await openEditor(page, "State");
  await setCode(
    editor,
    `stateDiagram-v2
  [*] --> Idle
  Idle --> Running : start
  Idle --> Stopped : halt
`,
  );
  await expectCode(editor).toContain("Idle --> Running : start");

  await clickPathMiddle(page, editor, "transition-2");
  await expect(editor.getByRole("heading", { name: "Transition" })).toBeVisible();
  // exact: the jump button beside each select is labelled "Select From/To …"
  await expect(editor.getByLabel("From", { exact: true })).toHaveValue("Idle");
  await expect(editor.getByLabel("To", { exact: true })).toHaveValue("Running");

  // re-pointing keeps the label, which redrawing the transition would lose
  await editor.getByLabel("To", { exact: true }).selectOption({ label: "Stopped" });
  await expectCode(editor).toContain("Idle --> Stopped : start");
  await expectCode(editor).not.toContain("Idle --> Running : start");

  await editor.getByRole("button", { name: "⇄ Swap ends" }).click();
  await expectCode(editor).toContain("Stopped --> Idle : start");

  // the button beside each end selects that state, so a dense diagram can be
  // walked from the property window rather than hunted for on the canvas
  await editor.getByRole("button", { name: "Select To on the canvas" }).click();
  await expect(editor.getByRole("heading", { name: "State" })).toBeVisible();
  await expect(editor.getByLabel("Label")).toHaveValue("Idle");
});

// Three composites inside each other: the frames used to be rebuilt from the
// leaves under them, so all three shared one left edge and the titles piled up.
const NESTED_SAMPLE = `stateDiagram-v2
  [*] --> Outer
  state Outer {
    [*] --> Middle
    state Middle {
      [*] --> Inner
      state Inner {
        [*] --> Leaf
        Leaf --> [*]
      }
      Inner --> Done
    }
    Middle --> Ready
  }
  Outer --> [*]
`;

test("nested composite frames are drawn inside one another", async ({ page }) => {
  const editor = await openEditor(page, "State");
  await setCode(editor, NESTED_SAMPLE);

  const frame = async (id: string) => {
    const box = await element(editor, id).locator("rect").first().boundingBox();
    if (!box) throw new Error(`no frame for ${id}`);
    return box;
  };
  const outer = await frame("Outer");
  const middle = await frame("Middle");
  const inner = await frame("Inner");
  for (const [parent, child] of [
    [outer, middle],
    [middle, inner],
  ] as const) {
    expect(child.x).toBeGreaterThan(parent.x);
    expect(child.y).toBeGreaterThan(parent.y);
    expect(child.x + child.width).toBeLessThan(parent.x + parent.width);
    expect(child.y + child.height).toBeLessThan(parent.y + parent.height);
  }
  // the innermost frame holds three members, so it stays small: the compound
  // layout it replaced stretched it to ~820px for the same three boxes
  expect(inner.height).toBeLessThan(300);
});
