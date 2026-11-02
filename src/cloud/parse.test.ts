import { describe, expect, it } from "vitest";
import { messages } from "../messages";
import { parseCloudState } from "./parse";
import type { CloudState } from "./types";

const now = "2026-10-19T09:00:00.000Z";

const validState = (): CloudState => ({
  list: { id: "list-1", title: "チームTODO", revision: 3 },
  users: [
    { id: "user-1", name: "あき", createdAt: now },
    { id: "user-2", name: "はる", createdAt: now },
  ],
  todos: [
    {
      id: "todo-1",
      title: "設計を確認",
      description: "仕様書を読む",
      deadline: "2026-10-20T18:00:00+09:00",
      priority: "high",
      status: "doing",
      assigneeIds: ["user-1"],
      tags: [],
      approvalStatus: null,
      approvalReason: null,
      createdAt: now,
      updatedAt: now,
      subtasks: [],
      notes: [
        {
          id: "note-1",
          text: "たたき台を共有",
          createdAt: now,
          userId: "user-1",
        },
        {
          id: "note-2",
          text: "修正済み",
          createdAt: now,
          editedAt: now,
          userId: null,
        },
      ],
    },
    {
      id: "todo-2",
      title: "買い物",
      description: "",
      deadline: null,
      priority: "low",
      status: "todo",
      assigneeIds: [],
      tags: ["申請"],
      approvalStatus: "pending",
      approvalReason: null,
      createdAt: now,
      updatedAt: now,
      subtasks: [],
      notes: [],
    },
  ],
  activities: [
    {
      id: "activity-1",
      todoId: "todo-1",
      userId: "user-1",
      kind: "todo.created",
      field: null,
      before: null,
      after: "設計を確認",
      createdAt: now,
    },
    {
      id: "activity-2",
      todoId: null,
      userId: null,
      kind: "list.renamed",
      field: "name",
      before: "旧名",
      after: "チームTODO",
      createdAt: now,
    },
  ],
});

const broken = (
  change: (state: any) => void,
  withNotifications = false,
): unknown => {
  const state = validState() as any;
  if (withNotifications)
    state.notifications = [
      {
        id: "notification-1",
        todoId: "todo-2",
        userId: "user-1",
        kind: "mention",
        body: "設計を確認して",
        createdAt: now,
      },
    ];
  change(state);
  return state;
};

const reject = (input: unknown) =>
  expect(() => parseCloudState(input)).toThrow(messages.errors.invalidState);

const validAttachment = () => ({
  id: "attachment-1",
  filename: "設計書.png",
  contentType: "image/png",
  sizeBytes: 1024,
  createdAt: now,
  createdBy: "user-1",
});

describe("parseCloudState", () => {
  it("正しい共有データをそのまま返す(添付がない場合は空配列を補完)", () => {
    const state = validState();
    const parsed = parseCloudState(state);
    // 添付は旧API/旧バックアップに無く、空配列として扱うため補完される。
    for (const todo of parsed.todos) expect(todo.attachments).toEqual([]);
    for (const todo of parsed.todos)
      for (const note of todo.notes) expect(note.attachments).toEqual([]);
    expect({ ...parsed, todos: state.todos }).toEqual(state);
  });

  it("サブタスクとメモの必須項目を検証する", () => {
    const subtask = validState().todos[0].subtasks[0] ?? {
      id: "subtask-1",
      title: "確認する",
      status: "todo" as const,
      priority: "medium" as const,
      deadline: null,
      createdAt: now,
      updatedAt: now,
      memos: [{ id: "subtask-memo-1", text: "補足", createdAt: now }],
    };
    const state = validState();
    state.todos[0].subtasks = [subtask];
    expect(parseCloudState(state)).toEqual({
      ...state,
      todos: [
        {
          ...state.todos[0],
          // 添付は旧データでも存在しないため空配列に補う。
          attachments: [],
          notes: state.todos[0].notes.map((note) => ({
            ...note,
            attachments: [],
          })),
        },
        { ...state.todos[1], attachments: [] },
      ],
    });
    const brokenSubtask = (change: (state: any) => void) => {
      const next = validState();
      next.todos[0].subtasks = [structuredClone(subtask)];
      change(next);
      return next;
    };
    reject(brokenSubtask((s) => (s.todos[0].subtasks[0].title = "")));
    reject(brokenSubtask((s) => delete s.todos[0].subtasks[0].deadline));
    reject(brokenSubtask((s) => (s.todos[0].subtasks[0].status = "doing")));
    reject(brokenSubtask((s) => delete s.todos[0].subtasks[0].memos[0].text));
    reject(
      brokenSubtask((s) => delete s.todos[0].subtasks[0].memos[0].createdAt),
    );
  });

  it("旧データのサブタスク欠落は空配列に補う", () => {
    const state = validState();
    delete (state.todos[0] as unknown as Record<string, unknown>).subtasks;
    const parsed = parseCloudState(state);
    expect(parsed.todos[0].subtasks).toEqual([]);
  });

  it("空の一覧を受け付ける", () => {
    const state = { ...validState(), users: [], todos: [], activities: [] };
    expect(parseCloudState(state)).toEqual(state);
  });

  it("オブジェクト以外は拒否する", () => {
    reject(null);
    reject([]);
    reject("{}");
    reject(undefined);
  });

  it("revision が数値でなければ拒否する", () => {
    reject(broken((s) => (s.list.revision = "3")));
    reject(broken((s) => (s.list.revision = null)));
    reject(broken((s) => delete s.list.revision));
    reject(broken((s) => (s.list.revision = 1.5)));
    reject(broken((s) => (s.list.revision = -1)));
  });

  it("users が配列でなければ拒否する", () => {
    reject(broken((s) => (s.users = {})));
    reject(broken((s) => (s.users = null)));
  });

  it("todos・activities・list の型を検証する", () => {
    reject(broken((s) => (s.todos = {})));
    reject(broken((s) => (s.activities = {})));
    reject(broken((s) => (s.list = [])));
  });

  it("TODO に assigneeIds がなければ拒否する", () => {
    reject(broken((s) => delete s.todos[0].assigneeIds));
    reject(broken((s) => (s.todos[0].assigneeIds = 1)));
    reject(broken((s) => (s.todos[0].assigneeIds = [""])));
  });

  it("旧単数 assigneeId だけのデータは配列に読み替える", () => {
    const legacy = broken((s) => {
      delete s.todos[0].assigneeIds;
      s.todos[0].assigneeId = "user-1";
    });
    const parsed = parseCloudState(legacy);
    expect(parsed.todos[0].assigneeIds).toEqual(["user-1"]);
    // 旧データの未割り当て(null)も空配列に読み替える。
    const cleared = broken((s) => {
      delete s.todos[0].assigneeIds;
      s.todos[0].assigneeId = null;
    });
    expect(parseCloudState(cleared).todos[0].assigneeIds).toEqual([]);
  });

  it("status が todo|doing|done 以外なら拒否する", () => {
    reject(broken((s) => (s.todos[0].status = "blocked")));
    reject(broken((s) => delete s.todos[0].status));
  });

  it("priority が high|medium|low 以外なら拒否する", () => {
    reject(broken((s) => (s.todos[0].priority = "urgent")));
  });

  it("activity の kind が既定の種類以外なら拒否する", () => {
    reject(broken((s) => (s.activities[0].kind = "todo.archived")));
    reject(broken((s) => delete s.activities[0].kind));
  });

  it("deadline が ISO 文字列ではなく数値なら拒否する", () => {
    reject(broken((s) => (s.todos[0].deadline = Date.parse(now))));
    reject(broken((s) => (s.todos[0].deadline = "not-a-date")));
    reject(broken((s) => delete s.todos[0].deadline));
  });

  it("日時は完全な ISO 8601 文字列でなければ拒否する", () => {
    reject(broken((s) => (s.users[0].createdAt = 0)));
    reject(broken((s) => (s.todos[0].createdAt = "yesterday")));
    reject(broken((s) => (s.todos[0].updatedAt = null)));
    reject(broken((s) => (s.todos[0].notes[0].createdAt = {})));
    reject(broken((s) => (s.todos[0].notes[1].editedAt = false)));
    reject(broken((s) => (s.activities[0].createdAt = undefined)));
    reject(broken((s) => (s.users[0].createdAt = "2026/10/19")));
    reject(broken((s) => (s.users[0].createdAt = "Oct 19 2026")));
    reject(broken((s) => (s.todos[0].createdAt = "2026-10-19")));
    reject(broken((s) => (s.todos[0].deadline = "2026-10-20")));
    reject(broken((s) => (s.todos[0].updatedAt = "2026-10-19T09:00:00")));
    reject(broken((s) => (s.todos[0].createdAt = "2026-02-30T00:00:00Z")));
    reject(broken((s) => (s.todos[0].createdAt = "2026-02-29T00:00:00Z")));
    reject(broken((s) => (s.todos[0].createdAt = "2026-13-01T00:00:00Z")));
    reject(broken((s) => (s.todos[0].createdAt = "2026-10-19T24:00:00Z")));
    reject(broken((s) => (s.todos[0].createdAt = "2026-10-19T09:60:00Z")));
  });

  it("ISO 8601 のタイムゾーン・秒・小数秒の表記を受け付ける", () => {
    const accept = (change: (state: any) => void) =>
      expect(() => parseCloudState(broken(change))).not.toThrow();
    accept((s) => (s.todos[0].deadline = "2026-10-20T18:00:00+0900"));
    accept((s) => (s.todos[0].createdAt = "2026-10-19T09:00Z"));
    accept((s) => (s.todos[0].updatedAt = "2026-10-19T09:00:00.123456Z"));
    accept((s) => (s.todos[0].notes[0].createdAt = "2026-10-19T09:00:00.1Z"));
    accept((s) => (s.todos[0].notes[1].editedAt = "2026-10-19T09:00:00-05:00"));
    accept((s) => (s.users[0].createdAt = "2028-02-29T00:00:00Z"));
    accept((s) => (s.activities[0].createdAt = "2026-10-19T09:00:00+09:00"));
  });

  it("TODO の必須項目と長さを検証する", () => {
    reject(broken((s) => (s.todos[0].title = "")));
    reject(broken((s) => (s.todos[0].title = "あ".repeat(121))));
    reject(broken((s) => (s.todos[0].description = null)));
    reject(broken((s) => (s.todos[0].description = "あ".repeat(2001))));
    reject(broken((s) => delete s.todos[0].notes));
  });

  it("メモの必須項目と長さを検証する", () => {
    reject(broken((s) => (s.todos[0].notes[0].text = "")));
    reject(broken((s) => (s.todos[0].notes[0].text = "あ".repeat(2001))));
    reject(broken((s) => delete s.todos[0].notes[0].id));
  });

  it("メモの userId は文字列または null だけを受け付ける", () => {
    reject(broken((s) => delete s.todos[0].notes[0].userId));
    reject(broken((s) => (s.todos[0].notes[0].userId = "")));
    reject(broken((s) => (s.todos[0].notes[0].userId = " ")));
    reject(broken((s) => (s.todos[0].notes[0].userId = 1)));
    reject(broken((s) => (s.todos[0].notes[0].userId = undefined)));
  });

  it("一覧とユーザーの必須項目を検証する", () => {
    reject(broken((s) => (s.list.title = "")));
    reject(broken((s) => (s.list.title = "あ".repeat(121))));
    reject(broken((s) => delete s.list.id));
    reject(broken((s) => (s.users[0].name = "")));
    reject(broken((s) => (s.users[0].name = "あ".repeat(121))));
  });

  it("activity の表示項目の型を検証する", () => {
    reject(broken((s) => (s.activities[0].before = 1)));
    reject(broken((s) => (s.activities[0].after = [])));
    reject(broken((s) => (s.activities[0].field = 2)));
    reject(broken((s) => (s.activities[0].todoId = 3)));
    reject(broken((s) => (s.activities[0].userId = true)));
    reject(broken((s) => delete s.activities[0].field));
  });

  it("ID の重複を拒否する", () => {
    reject(broken((s) => (s.users[1].id = s.users[0].id)));
    reject(broken((s) => (s.todos[1].id = s.todos[0].id)));
    reject(broken((s) => (s.todos[0].notes[1].id = s.todos[0].notes[0].id)));
    reject(broken((s) => (s.activities[1].id = s.activities[0].id)));
  });

  it("空白だけの ID を拒否する", () => {
    reject(broken((s) => (s.list.id = " ")));
    reject(broken((s) => (s.users[0].id = " ")));
    reject(broken((s) => (s.todos[0].id = "   ")));
    reject(broken((s) => (s.todos[0].notes[0].id = "\t")));
    reject(broken((s) => (s.activities[0].id = " ")));
  });

  it("不正な要素が1つでもあれば全体を拒否する", () => {
    const state = validState();
    state.todos.push({ ...state.todos[1], id: "todo-3", title: "" });
    reject(state);
  });

  it("タグ・承認状態・通知は新APIの値をそのまま受け入れる", () => {
    const state = validState() as unknown as Record<string, unknown>;
    state.notifications = [
      {
        id: "notification-1",
        todoId: "todo-2",
        userId: "user-1",
        kind: "mention",
        body: "設計を確認して",
        createdAt: now,
      },
    ];
    const parsed = parseCloudState(state);
    expect(parsed.todos[1]).toMatchObject({
      tags: ["申請"],
      approvalStatus: "pending",
      approvalReason: null,
    });
    expect(parsed.notifications).toEqual([
      expect.objectContaining({ kind: "mention", todoId: "todo-2" }),
    ]);
  });

  it("旧API由来の欠損フィールドは規定値へ補完する", () => {
    const state = validState();
    delete (state.todos[0] as { tags?: string[] }).tags;
    delete (state.todos[0] as { approvalStatus?: unknown }).approvalStatus;
    delete (state.todos[0] as { approvalReason?: unknown }).approvalReason;
    const parsed = parseCloudState(state);
    expect(parsed.todos[0]).toMatchObject({
      tags: [],
      approvalStatus: null,
      approvalReason: null,
    });
  });

  it("タグと承認状態の異常値を拒否する", () => {
    reject(broken((s) => (s.todos[0].tags = "申請")));
    reject(broken((s) => (s.todos[0].tags = [""])));
    reject(broken((s) => (s.todos[0].tags = ["あ".repeat(21)])));
    reject(broken((s) => (s.todos[0].approvalStatus = "unknown")));
    reject(broken((s) => (s.todos[0].approvalReason = 1)));
  });

  it("通知の型を検証する", () => {
    const state = validState() as unknown as Record<string, unknown>;
    state.notifications = [
      {
        id: "notification-1",
        todoId: null,
        userId: "user-1",
        kind: "todo.assigned",
        body: null,
        createdAt: now,
      },
    ];
    expect(parseCloudState(state).notifications).toHaveLength(1);
    reject(broken((s) => (s.notifications[0].kind = "unknown"), true));
    reject(broken((s) => (s.notifications[0].body = 1), true));
    reject(broken((s) => (s.notifications[0].id = " "), true));
  });

  it("メンバーの未読時刻は省略・null・ISO時刻を許す", () => {
    const state = validState();
    (
      state.users[0] as { notificationReadAt?: string | null }
    ).notificationReadAt = now;
    (
      state.users[1] as { notificationReadAt?: string | null }
    ).notificationReadAt = null;
    expect(() => parseCloudState(state)).not.toThrow();
    reject(broken((s) => (s.users[0].notificationReadAt = "not-a-date")));
  });

  it("TODO単位とメモ単位の添付を検証して返す", () => {
    const state = validState();
    state.todos[0].attachments = [validAttachment()];
    state.todos[0].notes[0].attachments = [
      { ...validAttachment(), id: "attachment-2" },
    ];
    const parsed = parseCloudState(state);
    expect(parsed.todos[0].attachments).toHaveLength(1);
    expect(parsed.todos[0].attachments?.[0]?.filename).toBe("設計書.png");
    expect(parsed.todos[0].notes[0].attachments).toHaveLength(1);
  });

  it("添付の異常値を拒否する", () => {
    reject(
      broken(
        (s) =>
          (s.todos[0].attachments = [{ ...validAttachment(), sizeBytes: 0 }]),
      ),
    );
    reject(
      broken(
        (s) =>
          (s.todos[0].attachments = [{ ...validAttachment(), sizeBytes: -1 }]),
      ),
    );
    reject(
      broken(
        (s) =>
          (s.todos[0].attachments = [
            { ...validAttachment(), createdAt: "not-a-date" },
          ]),
      ),
    );
    reject(
      broken(
        (s) =>
          (s.todos[0].attachments = [{ ...validAttachment(), filename: 1 }]),
      ),
    );
    reject(
      broken(
        (s) => (s.todos[0].attachments = [{ ...validAttachment(), id: " " }]),
      ),
    );
    reject(
      broken(
        (s) =>
          (s.todos[0].notes[0].attachments = [
            { ...validAttachment(), createdBy: 1 },
          ]),
      ),
    );
  });

  it("添付は旧データでは任意で、50件を超えると拒否する", () => {
    const many = Array.from({ length: 51 }, (_, index) => ({
      ...validAttachment(),
      id: "attachment-" + index,
    }));
    reject(broken((s) => (s.todos[0].attachments = many)));
    reject(
      broken(
        (s) =>
          (s.todos[0].notes[0].attachments = Array.from(
            { length: 51 },
            (_, index) => ({ ...validAttachment(), id: "m-" + index }),
          )),
      ),
    );
  });
});
