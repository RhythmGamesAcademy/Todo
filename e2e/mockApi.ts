// E2E 用のモック API。page.route で /api/** を横取りし、データベースなしで
// クラウド API(src/cloud/client.ts)と同じ振る舞いをメモリ上で再現する。
// ポーリングは /revision の値で差分検知するため、変更操作のたびに
// リビジョンを進めることと、state の形状を src/cloud/parse.ts の検証に
// 合わせることが条件。
import { SESSION_KEY } from "../src/cloud/session";
import type {
  Activity,
  CloudState,
  CloudTodo,
  CloudUser,
  TodoPatch,
} from "../src/cloud/types";
import type { Page, Route } from "@playwright/test";

const nowIso = () => new Date().toISOString();
let sequence = 0;
const nextId = (prefix: string) => `${prefix}-${++sequence}`;

export interface MockTodoSeed {
  id: string;
  title: string;
  description?: string;
  deadline?: string | null;
  priority?: CloudTodo["priority"];
  status?: CloudTodo["status"];
  assigneeId?: string | null;
  notes?: Array<{ id: string; text: string; userId?: string | null }>;
}

interface Board {
  id: string;
  title: string;
  revision: number;
  users: CloudUser[];
  todos: Map<string, CloudTodo>;
  trash: Map<string, CloudTodo>;
  activities: Activity[];
}

const DRAFT_KEYS = [
  "title",
  "description",
  "deadline",
  "priority",
  "status",
  "assigneeId",
] as const;

type JsonResponder = (status: number, data: unknown) => Promise<void>;

const toCloudTodo = (seed: MockTodoSeed): CloudTodo => {
  const createdAt = nowIso();
  return {
    id: seed.id,
    title: seed.title,
    description: seed.description ?? "",
    deadline: seed.deadline ?? null,
    priority: seed.priority ?? "medium",
    status: seed.status ?? "todo",
    assigneeId: seed.assigneeId ?? null,
    createdAt,
    updatedAt: createdAt,
    notes: (seed.notes ?? []).map((note) => ({
      id: note.id,
      text: note.text,
      createdAt,
      userId: note.userId ?? null,
    })),
  };
};

export class MockApi {
  private boards = new Map<string, Board>();
  // true の間はすべてのリクエストを通信エラーにする。テストから直接切り替える。
  failureMode = false;

  static async install(page: Page): Promise<MockApi> {
    const mock = new MockApi();
    await page.route("**/api/**", (route) => mock.handle(route));
    return mock;
  }

  seedBoard(options: {
    token?: string;
    title?: string;
    meName?: string;
    todos?: MockTodoSeed[];
  }): { token: string; me: { id: string; name: string } } {
    const token = options.token ?? nextId("token");
    const me = { id: "u-me", name: options.meName ?? "自分" };
    const board: Board = {
      id: nextId("board"),
      title: options.title ?? "テストリスト",
      revision: options.todos?.length ? 100 : 1,
      users: [{ id: me.id, name: me.name, createdAt: nowIso() }],
      todos: new Map(),
      trash: new Map(),
      activities: [],
    };
    for (const seed of options.todos ?? []) {
      board.todos.set(seed.id, toCloudTodo(seed));
    }
    this.boards.set(token, board);
    return { token, me };
  }

  snapshot(board: Board): CloudState {
    return {
      list: { id: board.id, title: board.title, revision: board.revision },
      users: board.users,
      todos: [...board.todos.values()],
      activities: [...board.activities],
    };
  }

  private async respond(route: Route, status: number, data: unknown) {
    await route.fulfill({
      status,
      contentType: "application/json",
      body: JSON.stringify(data),
    });
  }

  private async handle(route: Route) {
    const request = route.request();
    if (this.failureMode) {
      await this.respond(route, 503, { error: "mock failure" });
      return;
    }
    const method = request.method();
    const [, resource, token, ...rest] = urlParts(request.url());
    const ok = () => this.respond(route, 200, {});
    const notFound = () => this.respond(route, 404, { error: "not found" });
    const readBody = (): Record<string, unknown> => {
      const raw = request.postData();
      if (!raw) return {};
      try {
        return JSON.parse(raw) as Record<string, unknown>;
      } catch {
        return {};
      }
    };
    const json: JsonResponder = (status, data) =>
      this.respond(route, status, data);

    if (resource !== "lists") {
      await notFound();
      return;
    }
    if (!token) {
      if (method === "POST") {
        const title = String(readBody().title ?? "").trim();
        const tokenName = nextId("token");
        this.boards.set(tokenName, {
          id: nextId("board"),
          title: title || "無題のリスト",
          revision: 1,
          users: [],
          todos: new Map(),
          trash: new Map(),
          activities: [],
        });
        await json(201, { token: tokenName });
        return;
      }
      await notFound();
      return;
    }
    const board = this.boards.get(token);
    const [first, second, third] = rest;
    if (first === "join" && method === "POST" && board) {
      await this.join(board, readBody(), json);
      return;
    }
    if (!board) {
      await notFound();
      return;
    }
    if (!first) {
      if (method === "GET") {
        await json(200, this.snapshot(board));
        return;
      }
      if (method === "PATCH") {
        board.title = String(readBody().title ?? board.title).trim();
        board.revision++;
        await ok();
        return;
      }
      if (method === "DELETE") {
        this.boards.delete(token);
        await ok();
        return;
      }
      await notFound();
      return;
    }
    if (first === "revision" && method === "GET" && !second) {
      await json(200, { revision: board.revision });
      return;
    }
    if (first === "todos" && !second && method === "POST") {
      await this.createTodo(board, readBody(), json);
      return;
    }
    if (first === "todos" && second) {
      await this.todoRoute(board, second, third, method, readBody(), ok, json);
      return;
    }
    if (first === "users" && second) {
      await this.userRoute(route, board, second, method, readBody());
      return;
    }
    await notFound();
  }

  private async join(
    board: Board,
    body: Record<string, unknown>,
    json: JsonResponder,
  ) {
    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (!name || name.length > 120) {
      await json(400, { error: "invalid name" });
      return;
    }
    if (board.users.some((user) => user.name === name)) {
      await json(409, { error: "duplicated name" });
      return;
    }
    const user: CloudUser = { id: nextId("user"), name, createdAt: nowIso() };
    board.users.push(user);
    board.revision++;
    board.activities.push({
      id: nextId("activity"),
      todoId: null,
      userId: user.id,
      kind: "user.joined",
      field: null,
      before: null,
      after: null,
      createdAt: nowIso(),
    });
    await json(200, { userId: user.id, name });
  }

  private async createTodo(
    board: Board,
    body: Record<string, unknown>,
    json: JsonResponder,
  ) {
    const title = typeof body.title === "string" ? body.title : "";
    if (!title.trim() || title.length > 120) {
      await json(400, { error: "invalid title" });
      return;
    }
    const createdAt = nowIso();
    const todo: CloudTodo = {
      id: nextId("todo"),
      title,
      description: typeof body.description === "string" ? body.description : "",
      deadline: typeof body.deadline === "string" ? body.deadline : null,
      priority:
        body.priority === "high" ||
        body.priority === "medium" ||
        body.priority === "low"
          ? body.priority
          : "medium",
      status:
        body.status === "doing" || body.status === "done"
          ? body.status
          : "todo",
      assigneeId:
        typeof body.assigneeId === "string" && body.assigneeId.trim()
          ? body.assigneeId.trim()
          : null,
      createdAt,
      updatedAt: createdAt,
      notes: [],
    };
    board.todos.set(todo.id, todo);
    board.revision++;
    board.activities.push({
      id: nextId("activity"),
      todoId: todo.id,
      userId: typeof body.userId === "string" ? body.userId : null,
      kind: "todo.created",
      field: null,
      before: null,
      after: null,
      createdAt: nowIso(),
    });
    await json(201, { id: todo.id });
  }

  private async todoRoute(
    board: Board,
    todoId: string,
    action: string | undefined,
    method: string,
    body: Record<string, unknown>,
    ok: () => Promise<void>,
    json: JsonResponder,
  ) {
    const userId = typeof body.userId === "string" ? body.userId : null;
    const pushActivity = (
      kind: Activity["kind"],
      field: string | null,
      before: string | null,
      after: string | null,
    ) => {
      board.activities.push({
        id: nextId("activity"),
        todoId,
        userId,
        kind,
        field,
        before,
        after,
        createdAt: nowIso(),
      });
    };
    if (action === "restore" && method === "POST") {
      const todo = board.trash.get(todoId);
      if (!todo) return notFound();
      board.trash.delete(todoId);
      board.todos.set(todoId, todo);
      board.revision++;
      pushActivity("todo.restored", null, null, null);
      await ok();
      return;
    }
    const todo = board.todos.get(todoId);
    if (!todo) return notFound();
    if (action === "memos" && method === "POST") {
      const text = typeof body.text === "string" ? body.text : "";
      if (!text.trim() || text.length > 2000) {
        await json(400, { error: "invalid memo" });
        return;
      }
      todo.notes.push({
        id: nextId("note"),
        text,
        createdAt: nowIso(),
        userId,
      });
      board.revision++;
      await ok();
      return;
    }
    if (!action && method === "PATCH") {
      const patch = body as TodoPatch;
      const changed = patch as unknown as Record<string, unknown>;
      for (const key of DRAFT_KEYS) {
        if (!(key in changed)) continue;
        const before = todo[key];
        const after = changed[key];
        if (after === before) continue;
        (todo as unknown as Record<string, unknown>)[key] = after;
        pushActivity(
          "todo.updated",
          key,
          before === null ? null : String(before),
          after === null ? null : String(after),
        );
      }
      todo.updatedAt = nowIso();
      board.revision++;
      await json(200, { revision: board.revision });
      return;
    }
    if (!action && method === "DELETE") {
      board.todos.delete(todoId);
      board.trash.set(todoId, todo);
      board.revision++;
      pushActivity("todo.deleted", null, null, null);
      await ok();
      return;
    }
    await notFound();
  }

  private async userRoute(
    route: Route,
    board: Board,
    userId: string,
    method: string,
    body: Record<string, unknown>,
  ) {
    const user = board.users.find((candidate) => candidate.id === userId);
    if (!user) {
      await this.respond(route, 404, { error: "not found" });
      return;
    }
    if (method === "PATCH") {
      const name = typeof body.name === "string" ? body.name.trim() : "";
      if (name) user.name = name;
      board.revision++;
      await this.respond(route, 200, {});
      return;
    }
    if (method === "DELETE") {
      board.users = board.users.filter((candidate) => candidate.id !== userId);
      // 削除されたメンバーが担当中のTODOは未割り当てに戻る(ManageScreen の仕様)。
      for (const todo of board.todos.values()) {
        if (todo.assigneeId === userId) todo.assigneeId = null;
      }
      board.revision++;
      await this.respond(route, 200, {});
      return;
    }
    await this.respond(route, 404, { error: "not found" });
  }
}

function urlParts(url: string): string[] {
  return new URL(url).pathname
    .split("/")
    .filter(Boolean)
    .map((part) => decodeURIComponent(part));
}

export interface OpenBoardOptions {
  title?: string;
  meName?: string;
  todos?: MockTodoSeed[];
}

// モック API を接続し、保存済みセッションとして直接ボードを開く。
export async function openBoard(page: Page, options: OpenBoardOptions = {}) {
  const mock = await MockApi.install(page);
  const { token, me } = mock.seedBoard(options);
  await page.addInitScript(
    ({ key, session }: { key: string; session: string }) => {
      window.localStorage.setItem(key, session);
    },
    {
      key: SESSION_KEY,
      session: JSON.stringify({ token, userId: me.id, name: me.name }),
    },
  );
  await page.goto("/");
  return { mock, token, me };
}
