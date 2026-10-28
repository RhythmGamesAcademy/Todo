import { randomUUID } from "node:crypto";
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
  const postSubtask = (todoId: string, body: Record<string, unknown>) =>
    app.request(`/api/lists/${token}/todos/${todoId}/subtasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const patchSubtask = (
    todoId: string,
    subtaskId: string,
    body: Record<string, unknown>,
  ) =>
    app.request(`/api/lists/${token}/todos/${todoId}/subtasks/${subtaskId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  const postSubtaskMemo = (
    todoId: string,
    subtaskId: string,
    body: Record<string, unknown>,
  ) =>
    app.request(
      `/api/lists/${token}/todos/${todoId}/subtasks/${subtaskId}/memos`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );
  const deleteSubtask = (todoId: string, subtaskId: string) =>
    app.request(`/api/lists/${token}/todos/${todoId}/subtasks/${subtaskId}`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: creatorId }),
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
      subtasks: [],
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

  it("サブタスクの作成・完了切替・メモ・削除を親TODO単位で取得できる", async () => {
    const created = await postSubtask(todoId, {
      title: "資料を確認する",
      deadline: "2026-10-20T12:00:00.000Z",
      priority: "high",
      status: "todo",
      userId: creatorId,
    });
    expect(created.status).toBe(201);
    const subtaskId = ((await created.json()) as { id: string }).id;

    let state = await getState();
    let parent = state.todos.find((item: { id: string }) => item.id === todoId);
    expect(parent.subtasks).toMatchObject([
      {
        id: subtaskId,
        title: "資料を確認する",
        deadline: "2026-10-20T12:00:00.000Z",
        priority: "high",
        status: "todo",
        memos: [],
      },
    ]);

    const patched = await patchSubtask(todoId, subtaskId, {
      status: "done",
      userId: creatorId,
    });
    expect(patched.status).toBe(200);
    expect(
      ((await patched.json()) as { revision: number }).revision,
    ).toBeGreaterThan(state.list.revision);

    const memo = await postSubtaskMemo(todoId, subtaskId, {
      body: "確認済み",
      userId: creatorId,
    });
    expect(memo.status).toBe(201);

    state = await getState();
    parent = state.todos.find((item: { id: string }) => item.id === todoId);
    expect(parent.subtasks).toMatchObject([
      {
        id: subtaskId,
        status: "done",
        memos: [{ text: "確認済み" }],
      },
    ]);

    const deleted = await deleteSubtask(todoId, subtaskId);
    expect(deleted.status).toBe(200);
    state = await getState();
    parent = state.todos.find((item: { id: string }) => item.id === todoId);
    expect(parent.subtasks).toEqual([]);
  });

  it("サブタスクの入力検証は不正なタイトル・メモ・期限・状態・優先度を拒否する", async () => {
    const valid = {
      title: "検証対象",
      deadline: "2026-10-20T12:00:00.000Z",
      priority: "medium",
      status: "todo",
    };
    const invalidSubtasks = [
      { title: "  " },
      { title: "あ".repeat(121) },
      { deadline: "2026-10-20" },
      { status: "doing" },
      { priority: "urgent" },
    ];

    for (const patch of invalidSubtasks) {
      const response = await postSubtask(todoId, { ...valid, ...patch });
      expect(response.status).toBe(400);
    }

    const subtask = await postSubtask(todoId, valid);
    expect(subtask.status).toBe(201);
    const subtaskId = ((await subtask.json()) as { id: string }).id;
    for (const patch of invalidSubtasks) {
      const response = await patchSubtask(todoId, subtaskId, patch);
      expect(response.status).toBe(400);
    }

    for (const body of [{ body: "  " }, { body: "あ".repeat(2001) }]) {
      const response = await postSubtaskMemo(todoId, subtaskId, body);
      expect(response.status).toBe(400);
    }
  });

  it("存在しない親TODO・サブタスクへの操作は404", async () => {
    const missingTodo = "00000000-0000-4000-8000-000000000000";
    const missingSubtask = "00000000-0000-4000-8000-000000000001";
    const valid = {
      title: "存在しない対象",
      priority: "low",
      status: "todo",
    };

    expect((await postSubtask(missingTodo, valid)).status).toBe(404);
    expect(
      (await patchSubtask(todoId, missingSubtask, { status: "done" })).status,
    ).toBe(404);
    expect((await deleteSubtask(todoId, missingSubtask)).status).toBe(404);
    expect(
      (await postSubtaskMemo(todoId, missingSubtask, { body: "メモ" })).status,
    ).toBe(404);
  });

  it("親TODOの削除でサブタスクとサブタスクメモがカスケード削除される", async () => {
    const todoRes = await postTodo({
      title: "サブタスクの親",
      status: "todo",
      priority: "low",
      userId: creatorId,
    });
    expect(todoRes.status).toBe(201);
    const parentTodoId = ((await todoRes.json()) as { id: string }).id;
    const subtaskId = randomUUID();
    const memoId = randomUUID();

    await db.sql`
      INSERT INTO public.subtasks (id, todo_id, title, status, priority, due)
      VALUES (
        ${subtaskId},
        ${parentTodoId},
        'サブタスク',
        'todo',
        'medium',
        NULL
      )
    `;
    await db.sql`
      INSERT INTO public.subtask_memos (id, subtask_id, body)
      VALUES (${memoId}, ${subtaskId}, 'サブタスクのメモ')
    `;

    await db.sql`DELETE FROM public.todos WHERE id = ${parentTodoId}`;

    const subtaskRows = await db.sql`
      SELECT id FROM public.subtasks WHERE id = ${subtaskId}
    `;
    const memoRows = await db.sql`
      SELECT id FROM public.subtask_memos WHERE id = ${memoId}
    `;
    expect(subtaskRows.rows).toHaveLength(0);
    expect(memoRows.rows).toHaveLength(0);
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
    const subtaskRes = await postSubtask(todoId, {
      title: "削除後に戻るサブタスク",
      priority: "medium",
      status: "todo",
      userId: creatorId,
    });
    expect(subtaskRes.status).toBe(201);
    const restoredSubtaskId = ((await subtaskRes.json()) as { id: string }).id;
    const subtaskMemoRes = await postSubtaskMemo(todoId, restoredSubtaskId, {
      body: "削除後も戻るメモ",
      userId: creatorId,
    });
    expect(subtaskMemoRes.status).toBe(201);

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
      userId: creatorId,
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
    expect(
      state.todos.flatMap((item: { subtasks: unknown[] }) => item.subtasks),
    ).not.toContainEqual(expect.objectContaining({ id: restoredSubtaskId }));
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
    expect(todo.subtasks).toContainEqual(
      expect.objectContaining({
        id: restoredSubtaskId,
        memos: [expect.objectContaining({ text: "削除後も戻るメモ" })],
      }),
    );
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

  it("リスト名のPATCHはタイトルと履歴を更新し、revision を進める", async () => {
    const before = await getState();
    const res = await app.request(`/api/lists/${token}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "改名チーム", userId: creatorId }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { revision: number };
    expect(body.revision).toBeGreaterThan(before.list.revision);

    const state = await getState();
    expect(state.list.title).toBe("改名チーム");
    expect(state.list.revision).toBe(body.revision);
    const activity = state.activities.find(
      (item: { kind: string }) => item.kind === "list.renamed",
    );
    expect(activity).toMatchObject({
      todoId: null,
      userId: creatorId,
      field: "title",
      before: "チームTODO",
      after: "改名チーム",
    });

    const invalid = await app.request(`/api/lists/${token}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "  " }),
    });
    expect(invalid.status).toBe(400);
    expect((await getState()).list.title).toBe("改名チーム");
  });

  it("メンバー名のPATCHは履歴を残し、同名の別メンバーは409", async () => {
    const join = async (name: string) => {
      const res = await app.request(`/api/lists/${token}/join`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      expect(res.status).toBe(200);
      return (await res.json()) as { userId: string; name: string };
    };
    const mio = await join("みお");
    const sora = await join("そら");

    const conflict = await app.request(
      `/api/lists/${token}/users/${mio.userId}`,
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: "そら", userId: creatorId }),
      },
    );
    expect(conflict.status).toBe(409);
    expect(await conflict.json()).toMatchObject({ error: expect.any(String) });
    expect(
      (await getState()).users.find(
        (user: { id: string }) => user.id === mio.userId,
      ).name,
    ).toBe("みお");

    const res = await app.request(`/api/lists/${token}/users/${mio.userId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "みおこ", userId: creatorId }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ userId: mio.userId, name: "みおこ" });

    const state = await getState();
    expect(
      state.users.find((user: { id: string }) => user.id === mio.userId).name,
    ).toBe("みおこ");
    expect(
      state.users.find((user: { id: string }) => user.id === sora.userId).name,
    ).toBe("そら");
    const activity = state.activities.find(
      (item: { kind: string; after: string | null }) =>
        item.kind === "user.renamed" && item.after === "みおこ",
    );
    expect(activity).toMatchObject({
      todoId: null,
      userId: creatorId,
      field: "name",
      before: "みお",
      after: "みおこ",
    });
  });

  it("メンバー削除は担当TODOを未割当にし、履歴とメモのuserIdをNULLで残す", async () => {
    const joined = await app.request(`/api/lists/${token}/join`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "ゆい" }),
    });
    const yui = (await joined.json()) as { userId: string };

    const created = await postTodo({
      title: "ゆいの担当",
      status: "todo",
      priority: "low",
      assigneeId: yui.userId,
      userId: creatorId,
    });
    expect(created.status).toBe(201);
    const todo = (await created.json()) as { id: string };

    const memoRes = await app.request(
      `/api/lists/${token}/todos/${todo.id}/memos`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ body: "ゆいのメモ", userId: yui.userId }),
      },
    );
    const memo = (await memoRes.json()) as { id: string };

    const res = await app.request(`/api/lists/${token}/users/${yui.userId}`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ userId: yui.userId }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({});

    const state = await getState();
    expect(() => parseCloudState(state)).not.toThrow();
    expect(
      state.users.find((user: { id: string }) => user.id === yui.userId),
    ).toBeUndefined();
    expect(
      state.todos.find((item: { id: string }) => item.id === todo.id),
    ).toMatchObject({ assigneeId: null, notes: [{ userId: null }] });
    expect(
      state.activities.find(
        (item: { kind: string; before: string | null }) =>
          item.kind === "user.removed" && item.before === "ゆい",
      ),
    ).toMatchObject({
      todoId: null,
      userId: null,
      field: null,
      before: "ゆい",
      after: null,
    });

    const [memoRow] = (
      await db.sql`SELECT user_id FROM memos WHERE id = ${memo.id}`
    ).rows;
    expect(memoRow.user_id).toBeNull();

    expect(
      (
        await app.request(`/api/lists/${token}/users/${yui.userId}`, {
          method: "DELETE",
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await app.request(`/api/lists/${token}/users/${yui.userId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "ゆい2" }),
        })
      ).status,
    ).toBe(404);
  });

  it("他のリストのメンバーやUUIDでないIDは404", async () => {
    const other = await app.request("/api/lists", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "別チーム", name: "べつ" }),
    });
    const otherToken = ((await other.json()) as { token: string }).token;
    const otherState = await (
      await app.request(`/api/lists/${otherToken}`)
    ).json();
    const outsiderId = otherState.users[0].id as string;

    expect(
      (
        await app.request(`/api/lists/${token}/users/${outsiderId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "のっとり" }),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await app.request(`/api/lists/${token}/users/${outsiderId}`, {
          method: "DELETE",
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await app.request(`/api/lists/${token}/users/not-a-uuid`, {
          method: "DELETE",
        })
      ).status,
    ).toBe(404);
    expect(
      (await app.request("/api/lists/unknown", { method: "DELETE" })).status,
    ).toBe(404);
    expect(
      (
        await app.request("/api/lists/unknown", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: "なし" }),
        })
      ).status,
    ).toBe(404);
  });
});

// リスト削除はデータを消すため、最後に独立したブロックで実行する。
describeDb("共有リストの削除", () => {
  const db = makeDb(databaseUrl ?? "");
  const app = createApp(db);

  beforeAll(async () => {
    await db.sql`DELETE FROM lists`;
  });

  it("リスト削除は配下を物理削除し、以降の全ルートが404になる", async () => {
    const created = await app.request("/api/lists", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "消えるチーム", name: "さくら" }),
    });
    expect(created.status).toBe(201);
    const { token } = (await created.json()) as { token: string };
    const state = await (await app.request(`/api/lists/${token}`)).json();
    const listId = state.list.id as string;
    const userId = state.users[0].id as string;

    const todoRes = await app.request(`/api/lists/${token}/todos`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "消えるTODO",
        status: "todo",
        priority: "medium",
        assigneeId: userId,
        userId,
      }),
    });
    expect(todoRes.status).toBe(201);
    const todoId = ((await todoRes.json()) as { id: string }).id;

    const deleted = await app.request(`/api/lists/${token}`, {
      method: "DELETE",
    });
    expect(deleted.status).toBe(200);
    expect(await deleted.json()).toEqual({});

    expect((await app.request(`/api/lists/${token}`)).status).toBe(404);
    expect((await app.request(`/api/lists/${token}/revision`)).status).toBe(
      404,
    );
    expect(
      (
        await app.request(`/api/lists/${token}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: "もうない" }),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await app.request(`/api/lists/${token}/join`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: "あとから" }),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await app.request(`/api/lists/${token}/todos`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title: "作れない",
            status: "todo",
            priority: "low",
          }),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await app.request(`/api/lists/${token}/todos/${todoId}`, {
          method: "DELETE",
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await app.request(`/api/lists/${token}/users/${userId}`, {
          method: "DELETE",
        })
      ).status,
    ).toBe(404);

    const [counts] = (
      await db.sql`
        SELECT
          (SELECT count(*) FROM todos WHERE list_id = ${listId}) AS todos,
          (SELECT count(*) FROM users WHERE list_id = ${listId}) AS users,
          (SELECT count(*) FROM activities WHERE list_id = ${listId}) AS activities
      `
    ).rows;
    expect(Number(counts.todos)).toBe(0);
    expect(Number(counts.users)).toBe(0);
    expect(Number(counts.activities)).toBe(0);
  });
});
