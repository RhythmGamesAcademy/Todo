import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import type { Context } from "hono";
import type { Note, Priority, Status } from "../../src/model";
import type {
  Activity,
  ActivityKind,
  CloudState,
  CloudTodo,
  CloudUser,
  TodoPatch,
} from "../../src/cloud/types";
import {
  ApiException,
  assertText,
  computeActivities,
  generateToken,
} from "./domain.js";
import type { DbInfo, Sql, SqlCall, Transact } from "./sql.js";

export interface AppDeps {
  sql: Sql;
  transact: Transact;
  describe?: () => Promise<DbInfo>;
}

interface ListRow {
  id: string;
  title: string;
  revision: string | number;
}

interface UserRow {
  id: string;
  name: string;
  created_at: unknown;
}

interface TodoRow {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: string;
  due: unknown;
  assignee_id: string | null;
  created_at: unknown;
  updated_at: unknown;
}

interface TodoRecordRow extends TodoRow {
  deleted_at: unknown;
}

interface UserRefRow {
  id: string;
  name: string;
}

interface MemoRow {
  id: string;
  todo_id: string;
  user_id: string | null;
  body: string;
  created_at: unknown;
}

interface ActivityRow {
  id: string;
  todo_id: string | null;
  user_id: string | null;
  kind: string;
  field: string | null;
  before: string | null;
  after: string | null;
  created_at: unknown;
}

const rowsOf = <T>(result: { rows: unknown[] }): T[] => result.rows as T[];

const toIso = (value: unknown): string =>
  (value instanceof Date ? value : new Date(String(value))).toISOString();

const toCloudTodo = (row: TodoRow): CloudTodo => ({
  id: row.id,
  title: row.title,
  description: row.description,
  deadline: row.due === null ? null : toIso(row.due),
  priority: row.priority as Priority,
  status: row.status as Status,
  assigneeId: row.assignee_id,
  createdAt: toIso(row.created_at),
  updatedAt: toIso(row.updated_at),
  notes: [],
});

const STATUSES: readonly Status[] = ["todo", "doing", "done"];
const PRIORITIES: readonly Priority[] = ["high", "medium", "low"];
const ISO_TIMESTAMP =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/;
// UUID 以外の文字列を uuid 列と比較すると Postgres が 22P02 で落ちるため、
// 構文だけ先に確認して「存在しない ID」= 404 に寄せる。
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const parseEnum = <T extends string>(
  value: unknown,
  values: readonly T[],
  field: string,
): T => {
  if (
    typeof value !== "string" ||
    !(values as readonly string[]).includes(value)
  )
    throw new ApiException(400, `${field} is invalid`);
  return value as T;
};

const parseDeadline = (value: unknown): string | null => {
  if (value === null) return null;
  if (
    typeof value !== "string" ||
    !ISO_TIMESTAMP.test(value) ||
    Number.isNaN(Date.parse(value))
  )
    throw new ApiException(400, "deadline must be an ISO timestamp or null");
  return new Date(value).toISOString();
};

const parseDescription = (value: unknown): string => {
  if (typeof value !== "string")
    throw new ApiException(400, "description must be a string");
  const text = value.trim();
  if (text.length > 2000)
    throw new ApiException(400, "description must be at most 2000 characters");
  return text;
};

const parseUserId = (value: unknown, field: string): string => {
  if (typeof value !== "string" || !value.trim())
    throw new ApiException(400, `${field} must be a user id`);
  return value;
};

async function readJson(c: Context): Promise<Record<string, unknown>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new ApiException(400, "invalid JSON body");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body))
    throw new ApiException(400, "invalid JSON body");
  return body as Record<string, unknown>;
}

async function readOptionalJson(c: Context): Promise<Record<string, unknown>> {
  const text = await c.req.text();
  if (!text.trim()) return {};
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new ApiException(400, "invalid JSON body");
  }
  if (typeof body !== "object" || body === null || Array.isArray(body))
    throw new ApiException(400, "invalid JSON body");
  return body as Record<string, unknown>;
}

export function createApp({ sql, transact, describe }: AppDeps): Hono {
  const app = new Hono();

  const findList = async (token: string): Promise<ListRow | null> => {
    const [list] = rowsOf<ListRow>(
      await sql`SELECT id, title, revision FROM public.lists WHERE token = ${token}`,
    );
    return list ?? null;
  };

  const notFound = (c: Context) => c.json({ error: "not found" }, 404);

  const findUser = async (
    listId: string,
    userId: string,
  ): Promise<UserRefRow | null> => {
    if (!UUID.test(userId)) return null;
    const [user] = rowsOf<UserRefRow>(
      await sql`SELECT id, name FROM public.users WHERE list_id = ${listId} AND id = ${userId}`,
    );
    return user ?? null;
  };

  const requireUser = async (
    listId: string,
    userId: string,
  ): Promise<UserRefRow> => {
    const user = await findUser(listId, userId);
    if (!user) throw new ApiException(404, "user not found");
    return user;
  };

  // API v1 には認証済み呼び出し元の概念がないため、クライアントが任意で
  // userId を送る。リスト内の実ユーザーだけを受け付け、未指定なら NULL。
  const readOptionalUserId = async (
    body: Record<string, unknown>,
    listId: string,
  ): Promise<string | null> => {
    if (body.userId === undefined || body.userId === null) return null;
    const id = parseUserId(body.userId, "userId");
    await requireUser(listId, id);
    return id;
  };

  const readRevision = async (listId: string): Promise<number> => {
    const [row] = rowsOf<{ revision: string | number }>(
      await sql`SELECT revision FROM public.lists WHERE id = ${listId}`,
    );
    if (!row) throw new ApiException(404, "list not found");
    return Number(row.revision);
  };

  const findTodo = async (
    listId: string,
    id: string,
  ): Promise<TodoRecordRow | null> => {
    if (!UUID.test(id)) return null;
    const [todo] = rowsOf<TodoRecordRow>(
      await sql`
        SELECT id, title, description, status, priority, due, assignee_id,
               created_at, updated_at, deleted_at
        FROM public.todos
        WHERE id = ${id} AND list_id = ${listId}
      `,
    );
    return todo ?? null;
  };

  const addActivity = (
    listId: string,
    todoId: string | null,
    userId: string | null,
    kind: ActivityKind,
    field: string | null,
    before: string | null,
    after: string | null,
  ): SqlCall =>
    // now() はトランザクション開始時刻で同一になるため、履歴の並び順を保つために
    // 実行時刻の clock_timestamp() を明示する。
    sql`
      INSERT INTO public.activities (id, list_id, todo_id, user_id, kind, field, before, after, created_at)
      VALUES (${randomUUID()}, ${listId}, ${todoId}, ${userId}, ${kind}, ${field}, ${before}, ${after}, clock_timestamp())
    `;

  app.post("/api/lists", async (c) => {
    const body = await readJson(c);
    const title = assertText(body.title, 120, "title");
    const name = assertText(body.name, 120, "name");
    const token = generateToken();
    const listId = randomUUID();
    const userId = randomUUID();
    const activityId = randomUUID();
    await transact([
      sql`INSERT INTO public.lists (id, token, title) VALUES (${listId}, ${token}, ${title})`,
      sql`INSERT INTO public.users (id, list_id, name) VALUES (${userId}, ${listId}, ${name})`,
      sql`
        INSERT INTO public.activities (id, list_id, todo_id, user_id, kind, field, before, after, created_at)
        VALUES (${activityId}, ${listId}, NULL, ${userId}, 'user.joined', NULL, NULL, ${name}, clock_timestamp())
      `,
    ]);
    return c.json({ token }, 201);
  });

  app.patch("/api/lists/:token", async (c) => {
    const list = await findList(c.req.param("token"));
    if (!list) return notFound(c);
    const body = await readJson(c);
    const title = assertText(body.title, 120, "title");
    const userId = await readOptionalUserId(body, list.id);

    await transact([
      sql`UPDATE public.lists SET title = ${title} WHERE id = ${list.id}`,
      addActivity(
        list.id,
        null,
        userId,
        "list.renamed",
        "title",
        list.title,
        title,
      ),
    ]);
    return c.json({ revision: await readRevision(list.id) });
  });

  app.delete("/api/lists/:token", async (c) => {
    const list = await findList(c.req.param("token"));
    if (!list) return notFound(c);
    // 子テーブルは FK の ON DELETE CASCADE で物理削除される。
    // 確認 UI はクライアント側の責務なので、ここでは即時削除する。
    await sql`DELETE FROM public.lists WHERE id = ${list.id}`;
    return c.json({}, 200);
  });

  app.get("/api/lists/:token/revision", async (c) => {
    const list = await findList(c.req.param("token"));
    if (!list) return notFound(c);
    return c.json({ revision: Number(list.revision) });
  });

  app.post("/api/lists/:token/join", async (c) => {
    const list = await findList(c.req.param("token"));
    if (!list) return notFound(c);
    const body = await readJson(c);
    const name = assertText(body.name, 120, "name");
    const userId = randomUUID();
    const activityId = randomUUID();
    // 新規ユーザーが作られたときだけ user.joined を記録する。
    // 既存名の再参加では INSERT が競合し、EXISTS が偽になるため履歴も増えない。
    await transact([
      sql`
        INSERT INTO public.users (id, list_id, name)
        VALUES (${userId}, ${list.id}, ${name})
        ON CONFLICT (list_id, name) DO NOTHING
      `,
      sql`
        INSERT INTO public.activities (id, list_id, todo_id, user_id, kind, field, before, after, created_at)
        SELECT ${activityId}, ${list.id}, NULL, ${userId}, 'user.joined', NULL, NULL, ${name}, clock_timestamp()
        WHERE EXISTS (SELECT 1 FROM public.users WHERE id = ${userId})
      `,
    ]);
    const [user] = rowsOf<{ id: string }>(
      await sql`SELECT id FROM public.users WHERE list_id = ${list.id} AND name = ${name}`,
    );
    if (!user) throw new Error("failed to resolve joined user");
    return c.json({ userId: user.id, name });
  });

  app.patch("/api/lists/:token/users/:id", async (c) => {
    const list = await findList(c.req.param("token"));
    if (!list) return notFound(c);
    const user = await findUser(list.id, c.req.param("id"));
    if (!user) return notFound(c);
    const body = await readJson(c);
    const name = assertText(body.name, 120, "name");
    const userId = await readOptionalUserId(body, list.id);

    if (name === user.name) return c.json({ userId: user.id, name });

    const [conflict] = rowsOf<{ id: string }>(
      await sql`SELECT id FROM public.users WHERE list_id = ${list.id} AND name = ${name} AND id <> ${user.id}`,
    );
    if (conflict) throw new ApiException(409, "name already in use");

    await transact([
      sql`UPDATE public.users SET name = ${name} WHERE id = ${user.id} AND list_id = ${list.id}`,
      addActivity(
        list.id,
        null,
        userId,
        "user.renamed",
        "name",
        user.name,
        name,
      ),
    ]);
    return c.json({ userId: user.id, name });
  });

  app.delete("/api/lists/:token/users/:id", async (c) => {
    const list = await findList(c.req.param("token"));
    if (!list) return notFound(c);
    const user = await findUser(list.id, c.req.param("id"));
    if (!user) return notFound(c);
    const body = await readOptionalJson(c);
    const userId = await readOptionalUserId(body, list.id);

    // 履歴の user_id が削除対象を指す場合、users 削除時の FK で NULL になるため
    // activity を先に挿入する。担当 TODO の assignee_id も同じく NULL になる。
    await transact([
      addActivity(list.id, null, userId, "user.removed", null, user.name, null),
      sql`DELETE FROM public.users WHERE id = ${user.id} AND list_id = ${list.id}`,
    ]);
    return c.json({}, 200);
  });

  app.post("/api/lists/:token/todos", async (c) => {
    const list = await findList(c.req.param("token"));
    if (!list) return notFound(c);
    const body = await readJson(c);

    const title = assertText(body.title, 120, "title");
    const description =
      body.description === undefined ? "" : parseDescription(body.description);
    const deadline =
      body.deadline === undefined ? null : parseDeadline(body.deadline);
    const status = parseEnum(body.status, STATUSES, "status");
    const priority = parseEnum(body.priority, PRIORITIES, "priority");
    const assigneeId =
      body.assigneeId === undefined || body.assigneeId === null
        ? null
        : (
            await requireUser(
              list.id,
              parseUserId(body.assigneeId, "assigneeId"),
            )
          ).id;
    const userId = await readOptionalUserId(body, list.id);

    const id = randomUUID();
    await transact([
      sql`
        INSERT INTO public.todos (id, list_id, title, description, status, priority, due, assignee_id)
        VALUES (${id}, ${list.id}, ${title}, ${description}, ${status}, ${priority}, ${deadline}, ${assigneeId})
      `,
      addActivity(list.id, id, userId, "todo.created", null, null, title),
    ]);
    return c.json({ id }, 201);
  });

  app.patch("/api/lists/:token/todos/:id", async (c) => {
    const list = await findList(c.req.param("token"));
    if (!list) return notFound(c);
    const row = await findTodo(list.id, c.req.param("id"));
    if (!row || row.deleted_at !== null) return notFound(c);
    const body = await readJson(c);

    const patch: TodoPatch = {};
    if (body.title !== undefined)
      patch.title = assertText(body.title, 120, "title");
    if (body.description !== undefined)
      patch.description = parseDescription(body.description);
    if (body.deadline !== undefined)
      patch.deadline = parseDeadline(body.deadline);
    if (body.status !== undefined)
      patch.status = parseEnum(body.status, STATUSES, "status");
    if (body.priority !== undefined)
      patch.priority = parseEnum(body.priority, PRIORITIES, "priority");

    let assigneeAfter: UserRefRow | null | undefined;
    if (body.assigneeId !== undefined) {
      assigneeAfter =
        body.assigneeId === null
          ? null
          : await requireUser(
              list.id,
              parseUserId(body.assigneeId, "assigneeId"),
            );
      patch.assigneeId = assigneeAfter ? assigneeAfter.id : null;
    }
    const userId = await readOptionalUserId(body, list.id);

    const before = toCloudTodo(row);
    const assigneeChanged =
      patch.assigneeId !== undefined && patch.assigneeId !== before.assigneeId;
    let assigneeNameBefore: string | null = null;
    if (assigneeChanged && before.assigneeId) {
      assigneeNameBefore =
        (await findUser(list.id, before.assigneeId))?.name ?? null;
    }
    const assigneeNameAfter = assigneeChanged
      ? (assigneeAfter?.name ?? null)
      : null;
    const changes = computeActivities(
      before,
      patch,
      assigneeNameAfter,
      assigneeNameBefore,
    );

    if (changes.length === 0)
      return c.json({ revision: await readRevision(list.id) });

    const has = {
      title: patch.title !== undefined,
      description: patch.description !== undefined,
      deadline: patch.deadline !== undefined,
      status: patch.status !== undefined,
      priority: patch.priority !== undefined,
      assignee: patch.assigneeId !== undefined,
    };
    const nextDeadline =
      patch.deadline !== undefined ? patch.deadline : before.deadline;
    const nextAssigneeId =
      patch.assigneeId !== undefined ? patch.assigneeId : before.assigneeId;

    await transact([
      sql`
        UPDATE public.todos SET
          title = CASE WHEN ${has.title} THEN ${patch.title ?? before.title} ELSE title END,
          description = CASE WHEN ${has.description} THEN ${patch.description ?? before.description} ELSE description END,
          due = CASE WHEN ${has.deadline} THEN ${nextDeadline}::timestamptz ELSE due END,
          status = CASE WHEN ${has.status} THEN ${patch.status ?? before.status} ELSE status END,
          priority = CASE WHEN ${has.priority} THEN ${patch.priority ?? before.priority} ELSE priority END,
          assignee_id = CASE WHEN ${has.assignee} THEN ${nextAssigneeId}::uuid ELSE assignee_id END,
          updated_at = now()
        WHERE id = ${row.id} AND list_id = ${list.id} AND deleted_at IS NULL
      `,
      ...changes.map((change) =>
        addActivity(
          list.id,
          row.id,
          userId,
          "todo.updated",
          change.field,
          change.before,
          change.after,
        ),
      ),
    ]);
    return c.json({ revision: await readRevision(list.id) });
  });

  app.delete("/api/lists/:token/todos/:id", async (c) => {
    const list = await findList(c.req.param("token"));
    if (!list) return notFound(c);
    const row = await findTodo(list.id, c.req.param("id"));
    if (!row) return notFound(c);
    const body = await readOptionalJson(c);
    const userId = await readOptionalUserId(body, list.id);

    if (row.deleted_at !== null)
      return c.json({ revision: await readRevision(list.id) });

    await transact([
      sql`
        UPDATE public.todos SET deleted_at = now()
        WHERE id = ${row.id} AND list_id = ${list.id} AND deleted_at IS NULL
      `,
      addActivity(
        list.id,
        row.id,
        userId,
        "todo.deleted",
        null,
        row.title,
        null,
      ),
    ]);
    return c.json({ revision: await readRevision(list.id) });
  });

  app.post("/api/lists/:token/todos/:id/restore", async (c) => {
    const list = await findList(c.req.param("token"));
    if (!list) return notFound(c);
    const row = await findTodo(list.id, c.req.param("id"));
    if (!row) return notFound(c);
    const body = await readOptionalJson(c);
    const userId = await readOptionalUserId(body, list.id);

    if (row.deleted_at === null)
      return c.json({ revision: await readRevision(list.id) });

    await transact([
      sql`
        UPDATE public.todos SET deleted_at = NULL, updated_at = now()
        WHERE id = ${row.id} AND list_id = ${list.id} AND deleted_at IS NOT NULL
      `,
      addActivity(
        list.id,
        row.id,
        userId,
        "todo.restored",
        null,
        row.title,
        null,
      ),
    ]);
    return c.json({ revision: await readRevision(list.id) });
  });

  app.post("/api/lists/:token/todos/:id/memos", async (c) => {
    const list = await findList(c.req.param("token"));
    if (!list) return notFound(c);
    const row = await findTodo(list.id, c.req.param("id"));
    if (!row || row.deleted_at !== null) return notFound(c);
    const body = await readJson(c);

    const text = assertText(body.body, 2000, "body");
    const userId = await readOptionalUserId(body, list.id);
    const id = randomUUID();
    await sql`
      INSERT INTO public.memos (id, todo_id, user_id, body)
      VALUES (${id}, ${row.id}, ${userId}, ${text})
    `;
    return c.json({ id }, 201);
  });

  app.get("/api/lists/:token", async (c) => {
    const list = await findList(c.req.param("token"));
    if (!list) return notFound(c);

    const [usersResult, todosResult, memosResult, activitiesResult] =
      await Promise.all([
        sql`SELECT id, name, created_at FROM public.users WHERE list_id = ${list.id} ORDER BY created_at, id`,
        sql`SELECT id, title, description, status, priority, due, assignee_id, created_at, updated_at FROM public.todos WHERE list_id = ${list.id} AND deleted_at IS NULL ORDER BY created_at, id`,
        sql`SELECT m.id, m.todo_id, m.user_id, m.body, m.created_at FROM public.memos m JOIN public.todos t ON t.id = m.todo_id WHERE t.list_id = ${list.id} AND t.deleted_at IS NULL ORDER BY m.created_at, m.id`,
        sql`SELECT id, todo_id, user_id, kind, field, before, after, created_at FROM public.activities WHERE list_id = ${list.id} ORDER BY created_at, id`,
      ]);

    const notesByTodo = new Map<string, Note[]>();
    for (const memo of rowsOf<MemoRow>(memosResult)) {
      const note: Note = {
        id: memo.id,
        text: memo.body,
        createdAt: toIso(memo.created_at),
        userId: memo.user_id,
      };
      const notes = notesByTodo.get(memo.todo_id);
      if (notes) notes.push(note);
      else notesByTodo.set(memo.todo_id, [note]);
    }

    const state: CloudState = {
      list: {
        id: list.id,
        title: list.title,
        revision: Number(list.revision),
      },
      users: rowsOf<UserRow>(usersResult).map((user): CloudUser => ({
        id: user.id,
        name: user.name,
        createdAt: toIso(user.created_at),
      })),
      todos: rowsOf<TodoRow>(todosResult).map((todo): CloudTodo => ({
        ...toCloudTodo(todo),
        notes: notesByTodo.get(todo.id) ?? [],
      })),
      activities: rowsOf<ActivityRow>(activitiesResult).map(
        (activity): Activity => ({
          id: activity.id,
          todoId: activity.todo_id,
          userId: activity.user_id,
          kind: activity.kind as ActivityKind,
          field: activity.field,
          before: activity.before,
          after: activity.after,
          createdAt: toIso(activity.created_at),
        }),
      ),
    };
    return c.json(state);
  });

  app.notFound(notFound);

  app.onError((error, c) => {
    if (error instanceof ApiException)
      return c.json({ error: error.message }, error.status);
    if (describe) {
      void describe()
        .then((info) => console.error(error, { database: info }))
        .catch((diagnosticError: unknown) =>
          console.error(error, { databaseDiagnosticError: diagnosticError }),
        );
    } else {
      console.error(error);
    }
    return c.json({ error: "internal server error" }, 500);
  });

  return app;
}
