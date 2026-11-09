import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { parseCloudState } from "../../src/cloud/parse";
import { createApp } from "../../api/src/app";
import type { ObjectStorage } from "../../api/src/object-storage.js";
import { makeDb } from "../../api/src/sql";

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

  it("TODO作成は assigneeIds:[] / notes:[] で取得でき、作成履歴が残る", async () => {
    const res = await postTodo({
      title: "牛乳を買う",
      description: "スーパーで",
      deadline: "2026-10-20T12:00:00.000Z",
      priority: "medium",
      status: "todo",
      assigneeIds: [],
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
      assigneeIds: [],
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
      assigneeIds: [creatorId],
      userId: creatorId,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { revision: number };
    expect(body.revision).toBeGreaterThan(before.list.revision);

    const state = await getState();
    expect(state.list.revision).toBe(body.revision);
    const todo = state.todos.find((item: { id: string }) => item.id === todoId);
    expect(todo).toMatchObject({ status: "doing", assigneeIds: [creatorId] });

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

  it("担当者のPATCHは追加担当に通知し、履歴は名前を「、」結合して残す", async () => {
    const join = async (name: string) => {
      const res = await app.request(`/api/lists/${token}/join`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      expect(res.status).toBe(200);
      return (await res.json()) as { userId: string };
    };
    const yuki = await join("ゆき");
    const takeshi = await join("たけし");

    const created = await postTodo({
      title: "共同のTODO",
      status: "todo",
      priority: "low",
      assigneeIds: [],
      userId: creatorId,
    });
    expect(created.status).toBe(201);
    const id = ((await created.json()) as { id: string }).id;

    const res = await patchTodo(id, {
      assigneeIds: [yuki.userId, takeshi.userId],
      userId: creatorId,
    });
    expect(res.status).toBe(200);

    const state = await getState();
    const todo = state.todos.find((item: { id: string }) => item.id === id);
    expect(todo).toMatchObject({
      assigneeIds: [yuki.userId, takeshi.userId],
    });

    const activities = state.activities.filter(
      (item: { kind: string; todoId: string | null; field: string | null }) =>
        item.kind === "todo.updated" &&
        item.todoId === id &&
        item.field === "assignee",
    );
    expect(activities).toHaveLength(1);
    expect(activities[0]).toMatchObject({
      before: null,
      after: "ゆき、たけし",
    });

    const notifications = (
      await db.sql`SELECT user_id FROM public.notifications WHERE todo_id = ${id}`
    ).rows as Array<{ user_id: string }>;
    expect(notifications.map((row) => row.user_id)).toEqual([
      yuki.userId,
      takeshi.userId,
    ]);
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

  it("メンバー削除は担当TODOの担当配列から除き、履歴とメモのuserIdをNULLで残す", async () => {
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
      assigneeIds: [yui.userId, creatorId],
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
    ).toMatchObject({
      assigneeIds: [creatorId],
      notes: [{ userId: null }],
    });
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

// オブジェクトストレージを置き換えるテスト用クライアント。外部には触れない。
class FakeObjectStorage implements ObjectStorage {
  readonly uploads: Array<{
    key: string;
    contentType: string;
    size: number;
  }> = [];
  readonly signed: Array<{
    key: string;
    contentType: string;
    contentDisposition?: "inline" | "attachment";
  }> = [];
  readonly deletedKeys: string[] = [];
  failPut = false;
  failDelete = false;

  async put({
    key,
    contentType,
    body,
  }: {
    key: string;
    contentType: string;
    body: Blob;
  }): Promise<void> {
    if (this.failPut) throw new Error("storage put failed");
    this.uploads.push({
      key,
      contentType,
      size: body.size,
    });
  }

  async signedUrl({
    key,
    contentType,
    contentDisposition,
  }: {
    key: string;
    contentType: string;
    contentDisposition?: "inline" | "attachment";
  }): Promise<string> {
    this.signed.push({ key, contentType, contentDisposition });
    return `https://storage.example.test/${key}`;
  }

  async delete(key: string): Promise<void> {
    if (this.failDelete) throw new Error("storage delete failed");
    this.deletedKeys.push(key);
  }
}

const pngBytes = (): Uint8Array<ArrayBuffer> =>
  new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);

const newBytes = (length: number): Uint8Array<ArrayBuffer> =>
  new Uint8Array(new ArrayBuffer(length));

const pngFile = (): File =>
  new File([pngBytes()], "gazou.png", { type: "image/png" });

const txtFile = (body = "こんにちは", filename = "shot.txt"): File =>
  new File([new TextEncoder().encode(body)], filename, {
    type: "text/plain",
  });

// リスト削除はデータを消すため、最後に独立したブロックで実行する。
describeDb("添付ファイルAPI（オブジェクトストレージ連携）", () => {
  const db = makeDb(databaseUrl ?? "");
  const storage = new FakeObjectStorage();
  const app = createApp({ ...db, objectStorage: storage });
  // ストレージ未設定のときの挙動を確認するための別インスタンス。
  const bareApp = createApp(db);
  let token = "";
  let userId = "";
  let todoId = "";

  beforeAll(async () => {
    await db.sql`DELETE FROM lists`;
    const res = await app.request("/api/lists", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "添付チーム", name: "あき" }),
    });
    token = ((await res.json()) as { token: string }).token;
    const state = await (await app.request(`/api/lists/${token}`)).json();
    userId = state.users[0].id as string;
    const todoRes = await app.request(`/api/lists/${token}/todos`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "添付の親TODO",
        status: "todo",
        priority: "medium",
        assigneeIds: [],
        userId,
      }),
    });
    todoId = ((await todoRes.json()) as { id: string }).id;
  });

  const postTodoAttachment = (file: File) => {
    const form = new FormData();
    form.append("file", file, file.name);
    form.append("userId", userId);
    return app.request(`/api/lists/${token}/todos/${todoId}/attachments`, {
      method: "POST",
      body: form,
    });
  };

  const latestAttachmentId = async (): Promise<string> => {
    const [row] = (
      await db.sql`
        SELECT id FROM public.attachments WHERE todo_id = ${todoId}
        ORDER BY created_at DESC, id DESC LIMIT 1
      `
    ).rows as Array<{ id: string }>;
    return row.id;
  };

  const objectKeyOf = async (attachmentId: string): Promise<string> => {
    const [row] = (
      await db.sql`
        SELECT object_key FROM public.attachments WHERE id = ${attachmentId}
      `
    ).rows as Array<{ object_key: string }>;
    return row.object_key;
  };

  it("TODO単位の添付をオブジェクトストレージに保存してNeonに登録し、stateとURLの再取得で確認できる", async () => {
    const before = await (await app.request(`/api/lists/${token}`)).json();
    const res = await postTodoAttachment(pngFile());
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      attachment: { filename: string; contentType: string };
      revision: number;
    };
    expect(body.attachment).toEqual({
      filename: "gazou.png",
      contentType: "image/png",
    });
    expect(body.revision).toBeGreaterThan(before.list.revision);

    // ストレージへの保存は拡張子に対応した MIME と実サイズ、
    // サーバー生成キー(attachments/<UUID>)で行われる。
    expect(storage.uploads).toEqual([
      {
        key: expect.stringMatching(/^attachments\/[0-9a-f-]{36}$/),
        contentType: "image/png",
        size: 10,
      },
    ]);

    const state = await (await app.request(`/api/lists/${token}`)).json();
    expect(() => parseCloudState(state)).not.toThrow();
    const todo = state.todos.find((item: { id: string }) => item.id === todoId);
    expect(todo.attachments).toMatchObject([
      {
        filename: "gazou.png",
        contentType: "image/png",
        sizeBytes: 10,
        createdBy: userId,
      },
    ]);

    // URL は署名付きなため保存せず、必要時にストレージから引き直す。
    // プレビュー可能な形式(画像)は inline で署名する(監査 M-001)。
    const attachmentId = await latestAttachmentId();
    const objectKey = await objectKeyOf(attachmentId);
    const urlRes = await app.request(
      `/api/lists/${token}/attachments/${attachmentId}/url`,
    );
    expect(urlRes.status).toBe(200);
    expect(await urlRes.json()).toEqual({
      url: `https://storage.example.test/${objectKey}`,
      filename: "gazou.png",
      contentType: "image/png",
    });
    expect(storage.signed).toEqual([
      {
        key: objectKey,
        contentType: "image/png",
        contentDisposition: "inline",
      },
    ]);
  });

  it("プレビュー対象外の形式は Content-Disposition: attachment で署名する", async () => {
    // 未知の拡張子は許可リストで octet-stream に正規化され、"file" として
    // インライン表示せずダウンロードに強制する。
    const res = await postTodoAttachment(
      new File([pngBytes()], "gazou.bin", { type: "application/octet-stream" }),
    );
    expect(res.status).toBe(201);
    expect(storage.signed.at(-1)).toMatchObject({
      contentType: "application/octet-stream",
      contentDisposition: "attachment",
    });
  });

  it("メモ本文と一緒に添付を作成し、作成済みメモにも追加できる", async () => {
    const withAttachment = new FormData();
    withAttachment.append("body", "資料を確認した @あき");
    withAttachment.append("file", txtFile(), "note.txt");
    withAttachment.append("userId", userId);
    const created = await app.request(
      `/api/lists/${token}/todos/${todoId}/memos/with-attachment`,
      { method: "POST", body: withAttachment },
    );
    expect(created.status).toBe(201);
    const memo = (await created.json()) as { id: string; revision: number };

    const added = new FormData();
    added.append("file", pngFile(), "zumen.png");
    added.append("userId", userId);
    const appended = await app.request(
      `/api/lists/${token}/todos/${todoId}/memos/${memo.id}/attachments`,
      { method: "POST", body: added },
    );
    expect(appended.status).toBe(201);

    const state = await (await app.request(`/api/lists/${token}`)).json();
    expect(() => parseCloudState(state)).not.toThrow();
    const todo = state.todos.find((item: { id: string }) => item.id === todoId);
    const note = todo.notes.find((item: { id: string }) => item.id === memo.id);
    expect(note.attachments).toHaveLength(2);
    // TODO単位にも同じ2件が見える(メモ添付はTODOにも属す)。
    expect(todo.attachments).toHaveLength(note.attachments.length + 1);
  });

  it("MIME不一致・空ファイル・中身不一致は400、3MiB超過は413", async () => {
    const cases: Array<[File, number]> = [
      // 宣言されたMIMEの系統が拡張子と違う。
      [new File([pngBytes()], "gazou.png", { type: "text/plain" }), 400],
      // 空ファイル。
      [new File([], "karappo.txt", { type: "text/plain" }), 400],
      // 中身がPNGのマジックナンバーでない。
      [new File([newBytes(10)], "nise.png", { type: "image/png" }), 400],
      // 3MiB 超過。
      [
        new File([newBytes(3 * 1024 * 1024 + 1)], "ookii.png", {
          type: "image/png",
        }),
        413,
      ],
    ];
    for (const [file, expected] of cases) {
      const res = await postTodoAttachment(file);
      expect(res.status).toBe(expected);
    }
    // 失敗したリクエストではストレージへ書き込まない。
    expect(storage.uploads).toHaveLength(2);
  });

  it("fileフィールドがない multipart は400", async () => {
    const form = new FormData();
    form.append("userId", userId);
    const res = await app.request(
      `/api/lists/${token}/todos/${todoId}/attachments`,
      { method: "POST", body: form },
    );
    expect(res.status).toBe(400);
  });

  it("存在しないTODO・メモ・添付は404", async () => {
    const missingTodo = "00000000-0000-4000-8000-000000000002";
    const form = new FormData();
    form.append("file", txtFile(), "note.txt");
    form.append("userId", userId);
    expect(
      (
        await app.request(
          `/api/lists/${token}/todos/${missingTodo}/attachments`,
          {
            method: "POST",
            body: form,
          },
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await app.request(
          `/api/lists/${token}/todos/${missingTodo}/memos/with-attachment`,
          { method: "POST", body: form },
        )
      ).status,
    ).toBe(404);
    const missingMemo = "00000000-0000-4000-8000-000000000003";
    expect(
      (
        await app.request(
          `/api/lists/${token}/todos/${todoId}/memos/${missingMemo}/attachments`,
          { method: "POST", body: form },
        )
      ).status,
    ).toBe(404);
    expect(
      (await app.request(`/api/lists/${token}/attachments/${missingMemo}/url`))
        .status,
    ).toBe(404);
    expect(
      (
        await app.request(`/api/lists/${token}/attachments/${missingMemo}`, {
          method: "DELETE",
        })
      ).status,
    ).toBe(404);
  });

  it("ストレージへの保存が失敗したら500でNeonに登録しない", async () => {
    const failingStorage = new FakeObjectStorage();
    failingStorage.failPut = true;
    const failingApp = createApp({ ...db, objectStorage: failingStorage });
    const form = new FormData();
    form.append("file", pngFile(), "gazou.png");
    form.append("userId", userId);
    const res = await failingApp.request(
      `/api/lists/${token}/todos/${todoId}/attachments`,
      { method: "POST", body: form },
    );
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
    expect(await getAttachmentCount()).toBe(0);
  });

  it("添付削除はストレージのオブジェクトも削除し、失敗時は502で行を残す", async () => {
    // 追加の1件を用意して消す。
    const res = await postTodoAttachment(txtFile("消すやつ", "kesu.txt"));
    expect(res.status).toBe(201);
    const attachmentId = await latestAttachmentId();
    const objectKey = await objectKeyOf(attachmentId);

    storage.failDelete = true;
    const failed = await app.request(
      `/api/lists/${token}/attachments/${attachmentId}`,
      { method: "DELETE" },
    );
    expect(failed.status).toBe(502);
    expect(await getAttachmentCount()).toBeGreaterThan(0);
    // オブジェクト削除の失敗でもURLの再取得は可能。
    expect(
      (await app.request(`/api/lists/${token}/attachments/${attachmentId}/url`))
        .status,
    ).toBe(200);
    storage.failDelete = false;

    const ok = await app.request(
      `/api/lists/${token}/attachments/${attachmentId}`,
      { method: "DELETE" },
    );
    expect(ok.status).toBe(200);
    expect(storage.deletedKeys).toContain(objectKey);
    expect(await getAttachmentCount()).toBeGreaterThan(0);
    // 行が消えたので以降のURL取得は404。
    expect(
      (await app.request(`/api/lists/${token}/attachments/${attachmentId}/url`))
        .status,
    ).toBe(404);
  });

  const getAttachmentCount = async (): Promise<number> => {
    const [row] = (
      await db.sql`
        SELECT count(*)::int AS count FROM public.attachments WHERE todo_id = ${todoId}
      `
    ).rows as Array<{ count: number }>;
    return row.count;
  };

  it("TODOとメモの添付合計が上限に届くと400", async () => {
    // 上限のみを確認するため、直接Neonに50件積んでから1件送る。
    await db.sql`
      INSERT INTO public.attachments (
        id, todo_id, memo_id,
        object_key,
        filename, content_type, size_bytes, created_by
      )
      SELECT
        md5(random()::text || g::text)::uuid, ${todoId}, NULL,
        'attachments/seed-' || g,
        'seed.txt', 'text/plain', 3, ${userId}
      FROM generate_series(1, 50) AS g
    `;
    expect(await getAttachmentCount()).toBeGreaterThanOrEqual(50);
    const refused = await postTodoAttachment(txtFile("もう入らない"));
    expect(refused.status).toBe(400);
    // メモ経由でも同様に拒否される。
    const withMemo = new FormData();
    withMemo.append("body", "載らない");
    withMemo.append("file", txtFile());
    withMemo.append("userId", userId);
    const refused2 = await app.request(
      `/api/lists/${token}/todos/${todoId}/memos/with-attachment`,
      { method: "POST", body: withMemo },
    );
    expect(refused2.status).toBe(400);
    expect(await getAttachmentCount()).toBeGreaterThanOrEqual(50);
  });

  it("リスト削除でもストレージのオブジェクトを消し、失敗時は502で再試行できる", async () => {
    // 独立したリストでTODO＋添付を用意する。
    const cleanupStorage = new FakeObjectStorage();
    const cleanupApp = createApp({ ...db, objectStorage: cleanupStorage });
    const createdList = await cleanupApp.request("/api/lists", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "消す添付チーム", name: "さくら" }),
    });
    expect(createdList.status).toBe(201);
    const token = ((await createdList.json()) as { token: string }).token;
    const state = await (
      await cleanupApp.request(`/api/lists/${token}`)
    ).json();
    const listUserId = (state.users[0].id as string)!;
    const createdTodo = await cleanupApp.request(`/api/lists/${token}/todos`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "消すTODO",
        status: "todo",
        priority: "low",
        assigneeIds: [],
        userId: listUserId,
      }),
    });
    expect(createdTodo.status).toBe(201);
    const listTodoId = ((await createdTodo.json()) as { id: string }).id;

    const attach = new FormData();
    attach.append("file", txtFile("消える添付", "kieta.txt"));
    attach.append("userId", listUserId);
    const attached = await cleanupApp.request(
      `/api/lists/${token}/todos/${listTodoId}/attachments`,
      { method: "POST", body: attach },
    );
    expect(attached.status).toBe(201);
    expect(cleanupStorage.uploads).toHaveLength(1);
    const objectKey = cleanupStorage.uploads[0].key;

    cleanupStorage.failDelete = true;
    const firstTry = await cleanupApp.request(`/api/lists/${token}`, {
      method: "DELETE",
    });
    expect(firstTry.status).toBe(502);
    // リストは残るため、内容を確認できる。
    expect((await cleanupApp.request(`/api/lists/${token}`)).status).toBe(200);

    cleanupStorage.failDelete = false;
    const secondTry = await cleanupApp.request(`/api/lists/${token}`, {
      method: "DELETE",
    });
    expect(secondTry.status).toBe(200);
    expect(cleanupStorage.deletedKeys).toContain(objectKey);
    expect((await cleanupApp.request(`/api/lists/${token}`)).status).toBe(404);
  });

  it("オブジェクトストレージ未設定では投稿系が500", async () => {
    const form = new FormData();
    form.append("file", pngFile(), "gazou.png");
    form.append("userId", userId);
    expect(
      (
        await bareApp.request(
          `/api/lists/${token}/todos/${todoId}/attachments`,
          {
            method: "POST",
            body: form,
          },
        )
      ).status,
    ).toBe(500);
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
        assigneeIds: [userId],
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

// 大量の行を積むため、独立した最後のブロックで確認する。
describeDb("添付のリスト予算", () => {
  const db = makeDb(databaseUrl ?? "");
  const storage = new FakeObjectStorage();
  const app = createApp({ ...db, objectStorage: storage });
  let token = "";
  let userId = "";
  let todoId = "";

  beforeAll(async () => {
    await db.sql`DELETE FROM lists`;
    const res = await app.request("/api/lists", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "予算チーム", name: "よ" }),
    });
    token = ((await res.json()) as { token: string }).token;
    const state = await (await app.request(`/api/lists/${token}`)).json();
    userId = state.users[0].id as string;
    const listId = state.list.id as string;
    const todoRes = await app.request(`/api/lists/${token}/todos`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "予算の親",
        status: "todo",
        priority: "low",
      }),
    });
    todoId = ((await todoRes.json()) as { id: string }).id;
    // 予算用の別TODOに、上限(100MiB)を超える合計を直接積む。TODO単位の
    // 件数上限(50)に触れないよう、別TODOの行で帯域確保する。
    const [budgetTodo] = (
      await db.sql`
        INSERT INTO public.todos (id, list_id, title, status, priority)
        VALUES (${randomUUID()}, ${listId}, '予算用', 'todo', 'low')
        RETURNING id
      `
    ).rows as Array<{ id: string }>;
    // 70 × 1.5MiB = 105MiB > 100MiB。
    await db.sql`
      INSERT INTO public.attachments (
        id, todo_id, memo_id, object_key, filename, content_type, size_bytes
      )
      SELECT
        md5(random()::text || g::text)::uuid, ${budgetTodo.id}, NULL,
        'attachments/budget-seed-' || g, 'budget.txt', 'text/plain',
        1572864
      FROM generate_series(1, 70) AS g
    `;
  });

  const postTxt = (body: string) => {
    const form = new FormData();
    form.append("file", txtFile(body));
    form.append("userId", userId);
    return app.request(`/api/lists/${token}/todos/${todoId}/attachments`, {
      method: "POST",
      body: form,
    });
  };

  it("合計バイト数が上限を超えるとTODO単位でもメモ経由でも400", async () => {
    const res = await postTxt("予算超過");
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: "attachment storage budget exceeded",
    });
    const withMemo = new FormData();
    withMemo.append("body", "載らない");
    withMemo.append("file", txtFile());
    withMemo.append("userId", userId);
    const refused = await app.request(
      `/api/lists/${token}/todos/${todoId}/memos/with-attachment`,
      { method: "POST", body: withMemo },
    );
    expect(refused.status).toBe(400);
    // 上限で書き込みを止めるため、ストレージには何も積まれない。
    expect(storage.uploads).toHaveLength(0);
  });
});
