import { expect, test, type Page } from "@playwright/test"

// Runs against a real `opencode serve` driven by the scripted mock LLM (test/mock-llm).
// Tests share one server and build on each other, so they run serially.
test.describe.configure({ mode: "serial" })

let page: Page

test.beforeAll(async ({ browser }) => {
  page = await browser.newPage()
  await page.goto("/")
  await expect(page.locator(".project-name")).not.toHaveText("…")
})

test.afterAll(async () => page.close())

async function launch(prompt: string, attempts = 1) {
  await page.keyboard.press("n")
  await page.getByTestId("launch-prompt").fill(prompt)
  const current = Number(await page.getByTestId("attempts").innerText())
  for (let i = current; i < attempts; i++) await page.getByLabel("More attempts").click()
  for (let i = current; i > attempts; i--) await page.getByLabel("Fewer attempts").click()
  await expect(page.getByTestId("launch-submit")).toBeEnabled()
  await page.getByTestId("launch-submit").click()
}

test("launches a best-of-3 in separate worktrees and streams all three live", async () => {
  await expect(page.getByText("Run a fleet of OpenCode agents")).toBeVisible()
  await launch("Write release notes and run a check", 3)

  const tiles = page.getByTestId("tile")
  await expect(tiles).toHaveCount(3)
  for (const tile of await tiles.all()) {
    await expect(tile.getByTestId("assistant-message").first()).toBeVisible()
    await expect(tile.locator(".branch-badge")).toContainText("opencode/write-release-notes")
  }
  const branches = await tiles.locator(".branch-badge").allInnerTexts()
  expect(new Set(branches).size).toBe(3)
})

test("collects every agent's permission request in one inbox and approves from the keyboard", async () => {
  await page.getByTestId("nav-inbox").click()
  await expect(page.getByTestId("permission-card")).toHaveCount(3)
  await expect(page.getByTestId("nav-inbox").locator(".count")).toHaveText("3")
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press("a")
    await expect(page.getByTestId("permission-card")).toHaveCount(2 - i)
  }
  await expect(page.getByText("Inbox zero")).toBeVisible()
})

test("moves finished agents to review and compares their diffs", async () => {
  await page.getByTestId("nav-board").click()
  await expect(page.getByTestId("col-review").getByTestId("agent-card")).toHaveCount(3)
  await expect(page.getByTestId("group")).toContainText("Write release notes and run a check")

  await page
    .getByTestId("group")
    .getByRole("button", { name: /Compare 3/ })
    .click()
  await page.getByTestId("compare-diffs").click()
  await expect(page.locator(".diff-name", { hasText: "write-release-notes-and.md" })).toHaveCount(3)
})

test("keeps the winning attempt and archives its siblings", async () => {
  await page.getByTestId("tile").first().getByRole("button", { name: "Keep this one" }).click()
  await expect(page.getByTestId("tile")).toHaveCount(1)
  await page.getByTestId("nav-board").click()
  await expect(page.getByTestId("agent-card")).toHaveCount(1)
})

test("answers an agent's question and sees it finish", async () => {
  await launch("Draft API docs and ask me which style")
  await expect(page.locator(".agent-view")).toBeVisible()
  const question = page.getByTestId("question-card")
  await expect(question).toBeVisible()
  await expect(page.getByTestId("nav-inbox").locator(".count")).toHaveText("1")
  await question.getByRole("button", { name: /Concise/ }).click()
  await question.getByRole("button", { name: "Answer" }).click()
  await expect(page.locator(".msg-assistant .md").last()).toContainText("Done. I created")
  await expect(page.getByRole("tab", { name: /Plan/ })).toContainText("3/3")
  await page.getByRole("tab", { name: /Changes/ }).click()
  await expect(page.locator(".diff-name")).toContainText("draft-api-docs-and.md")
})

test("sends a follow-up from the composer", async () => {
  const input = page.getByTestId("composer-input")
  await input.fill("Now polish the wording")
  await input.press("Enter")
  await expect(page.getByTestId("user-message")).toHaveCount(2)
  await expect(page.getByTestId("tool-call").filter({ hasText: "polish-the-wording" }).first()).toBeVisible()
})

test("jumps to an agent from the command palette", async () => {
  await page.keyboard.press("Escape")
  await page.getByTestId("nav-board").click()
  await page.keyboard.press("Control+k")
  await page.getByTestId("palette-input").fill("release notes")
  await page.keyboard.press("Enter")
  await expect(page.locator(".agent-title")).toContainText("Write release notes")
})
