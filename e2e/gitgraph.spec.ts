import { expect, test } from "@playwright/test";
import { element, expectCode, openEditor, setCode, switchEditor } from "./helpers";

// Sample ids (the parser mints `commit-N` / `branch-N` in script order):
//   commit-1 init, commit-2 base, branch-1 develop, commit-3 wip,
//   commit-4 tests, commit-5 release (merge), commit-6 (unnamed, main)

test("editing a commit in the property window writes id, tags and type back into the code", async ({ page }) => {
  const editor = await openEditor(page, "Git graph");
  await expectCode(editor).toMatch(/^gitGraph/);

  await element(editor, "commit-2").click();
  await expect(editor.getByRole("heading", { name: "Commit", exact: true })).toBeVisible();

  const id = editor.getByLabel("Commit id");
  await expect(id).toHaveValue("base");
  await id.fill("stable");
  await id.blur();
  await expectCode(editor).toContain('commit id: "stable" tag: "v0.1"');

  const tags = editor.getByLabel("Tags");
  await tags.fill("v0.2, rc");
  await tags.press("Enter");
  await expectCode(editor).toContain('commit id: "stable" tag: "v0.2" tag: "rc"');

  await editor.getByLabel("Commit type").selectOption("REVERSE");
  await expectCode(editor).toContain('tag: "rc" type: REVERSE');

  await editor.getByLabel("Message").fill("second commit");
  await editor.getByLabel("Message").blur();
  await expectCode(editor).toContain('msg: "second commit"');

  await page.getByRole("button", { name: "Undo" }).click();
  await expectCode(editor).not.toContain('msg: "second commit"');
});

test("the toolbar adds a branch and commits; a branch is merged into another from its property window", async ({ page }) => {
  const editor = await openEditor(page, "Git graph");

  // a new branch forks from the branch of the selection, and becomes current
  await element(editor, "branch-main").click();
  await editor.getByRole("button", { name: "+ Branch" }).click();
  const name = editor.getByLabel("Branch name");
  await expect(name).toHaveValue("branch1");
  await name.fill("hotfix");
  await name.blur();
  await expectCode(editor).toMatch(/\n {2}branch hotfix$/);

  await editor.getByRole("button", { name: "+ Commit" }).click();
  await expectCode(editor).toMatch(/branch hotfix\n {2}commit$/);

  // back on the branch: merge it into main
  const hotfix = editor.locator('[data-element-id^="gbr_"]');
  await hotfix.click();
  await editor.getByLabel("Merge into").selectOption({ label: "main" });
  await editor.getByRole("button", { name: "Merge", exact: true }).click();
  await expectCode(editor).toMatch(/checkout main\n {2}merge hotfix$/);

  // a refused edit says why instead of silently snapping back
  await hotfix.click();
  await editor.getByLabel("Branch name").fill("main");
  await expect(editor.getByText("branch name: `main` already exists")).toBeVisible();
  await expectCode(editor).toContain("branch hotfix");

  await page.getByRole("button", { name: "Undo" }).click();
  await expectCode(editor).not.toMatch(/merge hotfix/);
});

test("a cherry-pick is made from a commit, and deleting its source takes it along", async ({ page }) => {
  const editor = await openEditor(page, "Git graph");

  // `tests` lives on develop; pick it onto main
  await element(editor, "commit-4").click();
  await editor.getByLabel("Cherry-pick onto").selectOption({ label: "main" });
  await editor.getByRole("button", { name: "Cherry-pick", exact: true }).click();
  await expect(editor.getByRole("heading", { name: "Cherry-pick" })).toBeVisible();
  await expectCode(editor).toMatch(/\n {2}cherry-pick id: "tests"$/);

  // the dedicated tags field takes over the default `cherry-pick:tests`
  const tags = editor.getByLabel("Tags");
  await tags.fill("hotfix");
  await tags.press("Enter");
  await expectCode(editor).toContain('cherry-pick id: "tests" tag: "hotfix"');

  await element(editor, "commit-4").click();
  await editor.getByRole("button", { name: "Delete commit" }).click();
  await expectCode(editor).not.toContain("cherry-pick");
});

test("the code pane drives the canvas: orientation, `switch`, and a script mermaid would refuse", async ({ page }) => {
  const editor = await openEditor(page, "Git graph");

  await editor.getByLabel("Direction").selectOption("TB");
  await expectCode(editor).toMatch(/^gitGraph TB:/);
  await editor.getByLabel("Direction").selectOption("LR");
  await expectCode(editor).toMatch(/^gitGraph\n/);

  await setCode(editor, 'gitGraph BT:\n  commit id: "a"\n  branch dev order: 2\n  switch dev\n  commit id: "b" tag: "t"\n  switch main\n  merge dev\n');
  await expect(element(editor, "commit-1")).toBeVisible();
  await expect(element(editor, "branch-1")).toBeVisible();
  // `switch main` is normalized to the canonical `checkout`
  await expectCode(editor).toContain("checkout main\n  merge dev");
  await expectCode(editor).toMatch(/^gitGraph BT:/);

  // a script that cannot run is refused, with the line, and the canvas keeps the last good diagram
  await setCode(editor, "gitGraph\n  commit\n  branch dev\n  checkout main\n  merge dev\n");
  await expect(editor.getByText(/both branches have the same head/)).toBeVisible();
  await expect(element(editor, "commit-1")).toBeVisible();
});

test("styling and title lines are tolerated and dropped with a warning", async ({ page }) => {
  const editor = await openEditor(page, "Git graph");
  await setCode(editor, 'gitGraph\n  title My history\n  commit id: "a"\n  style a fill:#f00\n');
  await expect(editor.getByText(/`title` is not represented/)).toBeVisible();
  await expect(editor.getByText(/`style` is not represented/)).toBeVisible();
  await expectCode(editor).toContain('commit id: "a"');
  await expectCode(editor).not.toContain("title");

  await test.step("deleting a branch removes its commits and merges", async () => {
    const fresh = await switchEditor(page, "Git graph");
    await setCode(fresh, "gitGraph\n  commit\n  branch dev\n  commit\n  checkout main\n  commit\n  merge dev\n");
    await element(fresh, "branch-1").click();
    await fresh.getByRole("button", { name: "Delete branch" }).click();
    await expectCode(fresh).not.toContain("branch dev");
    await expectCode(fresh).not.toContain("merge");
  });
});
