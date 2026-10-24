// 共有TODOリストの主要フローをモック API 上で確認する E2E テスト。
// テスト名は src/** の Vitest テストと同じく日本語で記載する。
import { expect, test, type Page } from "@playwright/test";
import { messages } from "../src/messages";
import { MockApi, openBoard, type MockTodoSeed } from "./mockApi";

const seed = (
  title: string,
  overrides: Partial<MockTodoSeed> = {},
): MockTodoSeed => ({
  id: "todo-" + title,
  title,
  ...overrides,
});

const detailButton = (page: Page, title: string) =>
  page.getByRole("button", { name: `${title}の詳細を開く` });

test("リストを作成してTODOを追加すると、一覧に表示される", async ({ page }) => {
  await MockApi.install(page);
  await page.goto("/");

  await page.getByRole("button", { name: messages.login.createTab }).click();
  await page.locator("#login-list-title").fill("家の用事");
  await page.locator("#login-create-name").fill("けん");
  await page.getByRole("button", { name: messages.login.createAction }).click();

  await expect(
    page.getByRole("heading", { name: messages.filters.heading.all }),
  ).toBeVisible();

  await page.locator(".create-button").click();
  await page.locator("#todo-title").fill("牛乳を買う");
  await page.locator("#todo-description").fill("2本買ってくる");
  await page.locator("#todo-deadline").fill("2026-10-24T23:00");
  await page.locator('.todo-form button[type="submit"]').click();

  await expect(page.locator(".toast")).toContainText(messages.todo.created);
  await expect(detailButton(page, "牛乳を買う")).toBeVisible();
  await expect(page.locator("#list-heading")).toContainText("1");
});

test("進行中のTODOを完了にすると、完了フィルタで確認できる", async ({
  page,
}) => {
  await openBoard(page, {
    todos: [seed("資料をまとめる", { status: "doing", priority: "high" })],
  });

  await detailButton(page, "資料をまとめる").click();
  await page
    .locator("#detail-status")
    .selectOption({ label: messages.status.done });

  // 完了演出はモーダルが閉じている間に再生されるため、先に詳細を閉じる。
  await page.locator("dialog[open] .modal-header .icon-button").click();
  const skip = page.locator(".completion-skip");
  await expect(skip).toBeVisible();
  await skip.click();
  const noticeClose = page.locator(".completion-notice-close");
  await noticeClose
    .waitFor({ state: "visible", timeout: 3000 })
    .catch(() => {});
  if (await noticeClose.isVisible().catch(() => false))
    await noticeClose.click();

  // ナビの文言は件数を含むため(例: 「完了 1」)、正規表現で一致させる。
  await page.getByRole("button", { name: /^完了 \d+$/ }).click();
  await expect(
    page.getByRole("heading", { name: messages.filters.heading.done }),
  ).toBeVisible();
  await expect(page.locator("#list-heading")).toContainText("1");
  await expect(detailButton(page, "資料をまとめる")).toBeVisible();
});

test("TODOを削除したあと、トーストの元に戻すで復元できる", async ({ page }) => {
  await openBoard(page, { todos: [seed("古いチラシ")] });

  await detailButton(page, "古いチラシ").click();
  await page
    .getByRole("button", { name: messages.todo.delete, exact: true })
    .click();
  await expect(page.locator(".confirm-content")).toContainText(
    "「古いチラシ」と、",
  );
  await page.locator(".confirm-content button.button-danger").click();

  await expect(page.locator(".toast")).toContainText(messages.todo.deleted);
  await expect(detailButton(page, "古いチラシ")).toHaveCount(0);

  await page.locator(".toast-undo").click();
  await expect(page.locator(".toast")).toContainText(messages.todo.restored);
  await expect(detailButton(page, "古いチラシ")).toBeVisible();
  await expect(page.locator("#list-heading")).toContainText("1");
});

test("検索を入力すると、該当するTODOだけが表示される", async ({ page }) => {
  await openBoard(page, {
    todos: [seed("牛乳を買う"), seed("猫の餌を買う"), seed("図書館へ本を返す")],
  });

  await page.locator("#todo-search").fill("牛乳");
  await expect(page.locator("#list-heading")).toContainText("1");
  await expect(detailButton(page, "牛乳を買う")).toBeVisible();
  await expect(detailButton(page, "猫の餌を買う")).toHaveCount(0);
  await expect(detailButton(page, "図書館へ本を返す")).toHaveCount(0);

  await page.getByRole("button", { name: messages.search.clear }).click();
  await expect(page.locator("#list-heading")).toContainText("3");
});

test("通信エラーが起きても、再試行でボードに復帰できる", async ({ page }) => {
  const { mock } = await openBoard(page, { todos: [seed("牛乳を買う")] });

  mock.failureMode = true;
  await page.reload();
  const alert = page.locator('.board-status[role="alert"]');
  await expect(alert).toContainText(messages.errors.api.general);

  mock.failureMode = false;
  await alert.getByRole("button", { name: messages.common.retry }).click();
  await expect(
    page.getByRole("heading", { name: messages.filters.heading.all }),
  ).toBeVisible();
  await expect(detailButton(page, "牛乳を買う")).toBeVisible();
});
