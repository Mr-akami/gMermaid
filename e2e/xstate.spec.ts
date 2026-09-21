import { expect, test } from "@playwright/test";
import { codeTab, codeText, element, expectCode, openEditor, setCode } from "./helpers";

// The State editor holds ONE diagram and shows it as two texts. Whichever one
// you type in, the canvas and the other text follow — and a GUI action moves
// both. Anything less would mean two masters (ADR 0002).

const MACHINE = `createMachine({
  initial: "idle",
  states: {
    idle: {
      entry: "reset",
      on: { FETCH: { target: "loading", actions: "log" } },
    },
    loading: {
      after: { 2000: "idle" },
      on: {
        RESOLVE: "done",
        REJECT: [{ guard: "canRetry", target: "loading" }, { target: "failed" }],
      },
    },
    done: { type: "final" },
    failed: { on: { RETRY: "loading" } },
  },
})`;

test("typing an XState machine drives the canvas and the mermaid text", async ({ page }) => {
  const editor = await openEditor(page, "State");
  await codeTab(editor, "XState");
  await setCode(editor, MACHINE);

  // every state XState named is on the canvas, plus the [*] start and end
  await expect(element(editor, "idle")).toBeVisible();
  await expect(element(editor, "loading")).toBeVisible();
  await expect(element(editor, "failed")).toBeVisible();
  await expect(element(editor, "state_start")).toBeVisible();
  await expect(element(editor, "state_end")).toBeVisible();

  await codeTab(editor, "Mermaid");
  await expectCode(editor).toContain("[*] --> idle");
  await expectCode(editor).toContain("idle --> loading : FETCH / log");
  await expectCode(editor).toContain("loading --> idle : after 2000ms");
  await expectCode(editor).toContain("loading --> loading : REJECT [canRetry]");
  await expectCode(editor).toContain("loading --> [*] : RESOLVE");
});

test("editing the mermaid text moves the XState text, keeping what mermaid cannot spell", async ({ page }) => {
  const editor = await openEditor(page, "State");
  await codeTab(editor, "XState");
  await setCode(editor, MACHINE);

  await codeTab(editor, "Mermaid");
  const mermaid = await codeText(editor);
  await setCode(editor, `${mermaid}\n  failed --> idle : GIVE_UP\n`);

  await codeTab(editor, "XState");
  await expectCode(editor).toContain("GIVE_UP");
  // the entry action has no mermaid syntax at all — it must still be there
  await expectCode(editor).toContain(`entry: "reset"`);
});

test("a toolbar action moves both texts at once", async ({ page }) => {
  const editor = await openEditor(page, "State");
  await codeTab(editor, "XState");
  await setCode(editor, MACHINE);

  await element(editor, "failed").click();
  await expect(editor.getByRole("heading", { name: "State" })).toBeVisible();
  await editor.getByRole("button", { name: "+ Child state" }).click();

  await expectCode(editor).toContain(`states: {`);
  await codeTab(editor, "Mermaid");
  await expectCode(editor).toMatch(/state failed \{/);
});

test("a machine the reader cannot accept says why, and leaves the diagram alone", async ({ page }) => {
  const editor = await openEditor(page, "State");
  await codeTab(editor, "XState");
  await setCode(editor, MACHINE);
  await expect(element(editor, "idle")).toBeVisible();

  await setCode(editor, `createMachine({ initial: "a", states: { a: { on: { GO: { cond: "ok", target: "a" } } } } })`);
  await expect(editor.locator(".code-errors")).toContainText("XState v4");
  // the diagram is untouched while the draft is broken
  await expect(element(editor, "idle")).toBeVisible();
});

test("the XState tab says what the machine cannot hold", async ({ page }) => {
  const editor = await openEditor(page, "State");
  // the sample diagram has a note and multi-state concurrency regions
  await codeTab(editor, "XState");
  await expect(editor.locator(".code-tab-panel:not(.hidden) .code-warnings")).toContainText("mermaid-only");
});
