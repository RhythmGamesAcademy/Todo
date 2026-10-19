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
} from "../../src/cloud/types";
import { ApiException, assertText, generateToken } from "./domain";
import type { Sql, Transact } from "./sql";

export interface AppDeps {
  sql: Sql;
  transact: Transact;
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

interface MemoRow {
  id: string;
  todo_id: string;
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

export function createApp({ sql, transact }: AppDeps): Hono {
  const app = new Hono();

  const findList = async (token: string): Promise<ListRow | null> => {
    const [list] = rowsOf<ListRow>(
      await sql`SELECT id, title, revision FROM lists WHERE token = ${token}`,
    );
    return list ?? null;
  };

  const notFound = (c: Context) => c.json({ error: "not found" }, 404);

  app.post("/api/lists", async (c) => {
    const body = await readJson(c);
    const title = assertText(body.title, 120, "title");
    const name = assertText(body.name, 120, "name");
    const token = generateToken();
    const listId = randomUUID();
    const userId = randomUUID();
    const activityId = randomUUID();
    await transact([
      sql`INSERT INTO lists (id, token, title) VALUES (${listId}, ${token}, ${title})`,
      sql`INSERT INTO users (id, list_id, name) VALUES (${userId}, ${listId}, ${name})`,
      sql`
        INSERT INTO activities (id, list_id, todo_id, user_id, kind, field, before, after)
        VALUES (${activityId}, ${listId}, NULL, ${userId}, 'user.joined', NULL, NULL, ${name})
      `,
    ]);
    return c.json({ token }, 201);
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
        INSERT INTO users (id, list_id, name)
        VALUES (${userId}, ${list.id}, ${name})
        ON CONFLICT (list_id, name) DO NOTHING
      `,
      sql`
        INSERT INTO activities (id, list_id, todo_id, user_id, kind, field, before, after)
        SELECT ${activityId}, ${list.id}, NULL, ${userId}, 'user.joined', NULL, NULL, ${name}
        WHERE EXISTS (SELECT 1 FROM users WHERE id = ${userId})
      `,
    ]);
    const [user] = rowsOf<{ id: string }>(
      await sql`SELECT id FROM users WHERE list_id = ${list.id} AND name = ${name}`,
    );
    if (!user) throw new Error("failed to resolve joined user");
    return c.json({ userId: user.id, name });
  });

  app.get("/api/lists/:token", async (c) => {
    const list = await findList(c.req.param("token"));
    if (!list) return notFound(c);

    const [usersResult, todosResult, memosResult, activitiesResult] =
      await Promise.all([
        sql`SELECT id, name, created_at FROM users WHERE list_id = ${list.id} ORDER BY created_at, id`,
        sql`SELECT id, title, description, status, priority, due, assignee_id, created_at, updated_at FROM todos WHERE list_id = ${list.id} AND deleted_at IS NULL ORDER BY created_at, id`,
        sql`SELECT m.id, m.todo_id, m.body, m.created_at FROM memos m JOIN todos t ON t.id = m.todo_id WHERE t.list_id = ${list.id} AND t.deleted_at IS NULL ORDER BY m.created_at, m.id`,
        sql`SELECT id, todo_id, user_id, kind, field, before, after, created_at FROM activities WHERE list_id = ${list.id} ORDER BY created_at, id`,
      ]);

    const notesByTodo = new Map<string, Note[]>();
    for (const memo of rowsOf<MemoRow>(memosResult)) {
      const note: Note = {
        id: memo.id,
        text: memo.body,
        createdAt: toIso(memo.created_at),
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
        id: todo.id,
        title: todo.title,
        description: todo.description,
        deadline: todo.due === null ? null : toIso(todo.due),
        priority: todo.priority as Priority,
        status: todo.status as Status,
        assigneeId: todo.assignee_id,
        createdAt: toIso(todo.created_at),
        updatedAt: toIso(todo.updated_at),
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
    console.error(error);
    return c.json({ error: "internal server error" }, 500);
  });

  return app;
}
