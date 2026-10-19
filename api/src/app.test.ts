import { beforeAll, describe, expect, it } from "vitest";
import { parseCloudState } from "../../src/cloud/parse";
import { createApp } from "./app";
import { makeDb } from "./sql";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeDb = databaseUrl ? describe : describe.skip;

describeDb("共有リストAPI", () => {
  const db = makeDb(databaseUrl ?? "");
  const app = createApp(db);
  let token = "";
  let creatorId = "";
  let todoId = "";

  const getState = async () =>
    await (await app.request(`/api/lists/${token}`)).json();
  const postTodo = (body: Record<string, unknown>) =>
    app.request(`/api/lists/${token}/todos`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const patchTodo = (id: string, body: Record<string, unknown>) =>
    app.request(`/api/lists/${token}/todos/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  beforeAll(async () => {
    await db.sql`DELETE FROM lists`;
    const res = await app.request("/api/lists", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "チームTODO", name: "あき" }),
    });
    expect(res.status).toBe(201);
    token = ((await res.json()) as { token: string }).token;
    const state = await (await app.request(`/api/lists/${token}`)).json();
    creatorId = state.users[0].id;
  });

  it("作成したリストのトークンは43文字のbase64url", () => {
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("全量取得は CloudState の検証を通り、revision は作成時の2のまま変わらない", async () => {
    const first = await app.request(`/api/lists/${token}`);
    expect(first.status).toBe(200);
    const state = await first.json();
    expect(() => parseCloudState(state)).not.toThrow();
    expect(state).toMatchObject({
      list: { title: "チームTODO", revision: 2 },
      todos: [],
    });
    expect(state.users).toHaveLength(1);
    expect(state.users[0]).toMatchObject({ name: "あき" });
    expect(state.users[0].id).toMatch(UUID);
    creatorId = state.users[0].id;
    expect(state.activities).toHaveLength(1);
    expect(state.activities[0]).toMatchObject({
      kind: "user.joined",
      after: "あき",
      userId: creatorId,
    });

    const second = await app.request(`/api/lists/${token}`);
    expect((await second.json()).list.revision).toBe(2);

    const revision = await app.request(`/api/lists/${token}/revision`);
    expect(revision.status).toBe(200);
    expect(await revision.json()).toEqual({ revision: 2 });
  });

  it("存在しないトークンは全ルートで404", async () => {
    expect((await app.request("/api/lists/unknown")).status).toBe(404);
    expect((await app.request("/api/lists/unknown/revision")).status).toBe(404);
    const join = await app.request("/api/lists/unknown/join", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "だれか" }),
    });
    expect(join.status).toBe(404);
  });

  it("新規名の参加は新しい userId、既存名は同じ userId を返す", async () => {
    const join = (name: string) =>
      app.request(`/api/lists/${token}/join`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });

    const first = await join("はる");
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as {
      userId: string;
      name: string;
    };
    expect(firstBody.name).toBe("はる");
    expect(firstBody.userId).toMatch(UUID);

    const joinedState = await (await app.request(`/api/lists/${token}`)).json();
    const joined = joinedState.activities.filter(
      (activity: { kind: string; after: string | null }) =>
        activity.kind === "user.joined" && activity.after === "はる",
    );
    expect(joined).toHaveLength(1);
    expect(joined[0].userId).toBe(firstBody.userId);

    const again = await join("はる");
    expect(((await again.json()) as { userId: string }).userId).toBe(
      firstBody.userId,
    );

    const creator = await join("あき");
    expect(((await creator.json()) as { userId: string }).userId).toBe(
      creatorId,
    );

    const finalState = await (await app.request(`/api/lists/${token}`)).json();
    expect(() => parseCloudState(finalState)).not.toThrow();
    const joinActivities = finalState.activities.filter(
      (activity: { kind: string }) => activity.kind === "user.joined",
    );
    expect(joinActivities).toHaveLength(2);
  });

  it("不正な作成リクエストは400を返す", async () => {
    const res = await app.request("/api/lists", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "  ", name: "あき" }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });

  it("TODO作成は assigneeId:null / notes:[] で取得でき、作成履歴が残る", async () => {
    const res = await postTodo({
      title: "牛乳を買う",
      description: "スーパーで",
      deadline: "2026-10-20T12:00:00.000Z",
      priority: "medium",
      status: "todo",
      assigneeId: null,
      userId: creatorId,
    });
    expect(res.status).toBe(201);
    const created = (await res.json()) as { id: string };
    todoId = created.id;
    expect(todoId).toMatch(UUID);

    const state = await getState();
    const todo = state.todos.find((item: { id: string }) => item.id === todoId);
    expect(todo).toMatchObject({
      title: "牛乳を買う",
      description: "スーパーで",
      deadline: "2026-10-20T12:00:00.000Z",
      priority: "medium",
      status: "todo",
      assigneeId: null,
      notes: [],
    });
    const activity = state.activities.find(
      (item: { kind: string; todoId: string | null }) =>
        item.kind === "todo.created" && item.todoId === todoId,
    );
    expect(activity).toMatchObject({
      after: "牛乳を買う",
      userId: creatorId,
    });
  });

  it("PATCH は変更フィールドだけ履歴に残し、revision を進める", async () => {
    const before = await getState();
    const res = await patchTodo(todoId, {
      status: "doing",
      assigneeId: creatorId,
      userId: creatorId,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { revision: number };
    expect(body.revision).toBeGreaterThan(before.list.revision);

    const state = await getState();
    expect(state.list.revision).toBe(body.revision);
    const todo = state.todos.find((item: { id: string }) => item.id === todoId);
    expect(todo).toMatchObject({ status: "doing", assigneeId: creatorId });

    const updates = state.activities.filter(
      (item: { kind: string; todoId: string | null }) =>
        item.kind === "todo.updated" && item.todoId === todoId,
    );
    expect(updates).toHaveLength(2);
    expect(updates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          field: "status",
          before: "todo",
          after: "doing",
          userId: creatorId,
        }),
        expect.objectContaining({
          field: "assignee",
          before: null,
          after: "あき",
          userId: creatorId,
        }),
      ]),
    );
  });

  it("同一TODOへの連続PATCHは両方200で後勝ちになる", async () => {
    expect((await patchTodo(todoId, { title: "一つ目" })).status).toBe(200);
    expect((await patchTodo(todoId, { title: "二つ目" })).status).toBe(200);

    const state = await getState();
    const todo = state.todos.find((item: { id: string }) => item.id === todoId);
    expect(todo.title).toBe("二つ目");
  });

  it("DELETEで非表示・restoreで再表示され、メモと履歴は維持される", async () => {
    const memoRes = await app.request(
      `/api/lists/${token}/todos/${todoId}/memos`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: "牛乳は低脂肪", userId: creatorId }),
      },
    );
    expect(memoRes.status).toBe(201);
    const memo = (await memoRes.json()) as { id: string };

    let state = await getState();
    let todo = state.todos.find((item: { id: string }) => item.id === todoId);
    expect(todo.notes).toHaveLength(1);
    expect(todo.notes[0]).toMatchObject({
      id: memo.id,
      text: "牛乳は低脂肪",
    });
    const titleBeforeDelete = todo.title;

    const del = await app.request(`/api/lists/${token}/todos/${todoId}`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: creatorId }),
    });
    expect(del.status).toBe(200);
    const deleted = (await del.json()) as { revision: number };
    expect(deleted.revision).toBeGreaterThan(state.list.revision);

    state = await getState();
    expect(
      state.todos.find((item: { id: string }) => item.id === todoId),
    ).toBeUndefined();
    const deleteActivity = state.activities.find(
      (item: { kind: string; todoId: string | null }) =>
        item.kind === "todo.deleted" && item.todoId === todoId,
    );
    expect(deleteActivity).toMatchObject({
      before: titleBeforeDelete,
      after: null,
      userId: creatorId,
    });

    const memoToDeleted = await app.request(
      `/api/lists/${token}/todos/${todoId}/memos`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: "消えたTODOへのメモ" }),
      },
    );
    expect(memoToDeleted.status).toBe(404);

    const deleteAgain = await app.request(
      `/api/lists/${token}/todos/${todoId}`,
      { method: "DELETE" },
    );
    expect(deleteAgain.status).toBe(200);

    const restored = await app.request(
      `/api/lists/${token}/todos/${todoId}/restore`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: creatorId }),
      },
    );
    expect(restored.status).toBe(200);

    state = await getState();
    expect(() => parseCloudState(state)).not.toThrow();
    todo = state.todos.find((item: { id: string }) => item.id === todoId);
    expect(todo).toBeDefined();
    expect(todo.notes).toHaveLength(1);
    expect(todo.notes[0]).toMatchObject({ id: memo.id, text: "牛乳は低脂肪" });
    const restoreActivity = state.activities.find(
      (item: { kind: string; todoId: string | null }) =>
        item.kind === "todo.restored" && item.todoId === todoId,
    );
    expect(restoreActivity).toMatchObject({
      before: titleBeforeDelete,
      after: null,
      userId: creatorId,
    });
  });

  it("存在しないTODOへのPATCH・DELETE・メモは404", async () => {
    const missing = "00000000-0000-4000-8000-000000000000";
    expect((await patchTodo(missing, { title: "なし" })).status).toBe(404);
    expect(
      (
        await app.request(`/api/lists/${token}/todos/${missing}`, {
          method: "DELETE",
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await app.request(`/api/lists/${token}/todos/${missing}/restore`, {
          method: "POST",
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await app.request(`/api/lists/${token}/todos/${missing}/memos`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ body: "メモ" }),
        })
      ).status,
    ).toBe(404);
  });
});
