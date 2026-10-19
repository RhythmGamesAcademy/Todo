# hitotsuzutsu クラウド共有版 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** localStorage 個人用 TODO を「トークン+ユーザー名で参加する共有 Todo リスト」にする。変更は数秒ポーリングで全員に反映し、GitHub Issue 風の変更履歴タイムラインを持つ。

**Architecture:** 既存 Vite + React 19 SPA を `src/cloud/` の同期層に差し替え。バックエンドはリポジトリ直下 `api/`(Hono on Vercel Node関数)+ Neon PostgreSQL(トリガーでリスト revision を加算)。書き込みはサーバーが唯一の正、last-write-wins。

**Tech Stack:** Vite / React 19 / TypeScript(strict) / Vitest + Testing Library / Hono / @neondatabase/serverless(HTTPドライバ) / PostgreSQL

**Spec:** `docs/superpowers/specs/2026-10-19-cloud-collaboration-design.md`(本計画は設計書に従って書かれている。設計書も必ず併読)

## Global Constraints

- 文言・日時書式・文章構築は**すべて** `src/messages.ts` に置く(コンポーネント直書き禁止)。新規文言も同様。
- 純粋ロジック(型・バリデーション・差分計算・並べ替え)は `src/model.ts` または新規モジュールに置き、DOM 不要のテストを付ける。
- `npm test`(vitest run)と `npm run build`(`tsc -b` 含む)を各タスクで壊さない。strict TS、未使用 import でビルド落ち。
- type-only import は `import type`(`verbatimModuleSyntax`)。
- Status 値は `"todo" | "doing" | "done"`、Priority は `"high" | "medium" | "low"`(既存 `src/model.ts` のまま)。DB にも同じ文字列で保存する。
- トークン: `crypto.randomBytes(32)` → base64url(43文字)。URL fragment `#token=` から受け取る。サーバーログに出さない。
- バリデーション上限(既存値を流用): title ≤120・description ≤2000・memo ≤2000。
- ファイル追加・移動時は README.md「技術構成」のファイル責任マップを更新する。
- `npm run format` は package.json に直接ハードコードされたファイルリスト — **新規ソースファイルを追加したら直ちに package.json の format スクリプトに追記する**。
- コミットメッセージ: Gitmoji + 日本語要約(例: `✨ 共有APIの土台を追加`)。
- インテグレーションテスト(`*.db.test.ts`)は `TEST_DATABASE_URL`(Neon devブランチのURL)が無ければ丸ごとスキップする。スキップ時もユニットのみでタスク完了と判定してよいが、環境変数があれば必ず通す。

## Review Focus

spec が示唆するが各タスクのテストで直接拾えず、人間が使い込んだときに刺す入力。最初が一番怪しい:

1. **同一TODOへの同時編集**:私がフォームを開いている間に他人が PATCH しても失敗せず、後勝ちで保存される → Task 5 のインテグレーションで「同一todoへの連続2回 PATCH が両方 200」で固定。
2. **開いたモーダルの対象が他人によって削除された**:ポーリングで取り込んだ状態に削除済みTODOが含まれないので、詳細は自動で閉じ、一覧に戻る → App ワイヤリング(詳細自動クローズは既存 `useEffect` 流用)+ Task 9 で「削除で view が閉じる」を回帰確認。
3. **リスト削除後の残存セッション**:トークンが死んだブラウザは、ポーリングの404で自動ログアウトしログイン画面へ → Task 7 の useBoard テスト。
4. **同じ revision の応答**:`revision` が一致したら全データを再取得しない(絞り込み・検索入力中の画面が荒ぶらない)→ Task 7 の useBoard テスト。
5. **壊れたセッション(localStorage に不正JSON / 見知らぬ形式)**:クラッシュせずログイン画面を表示 → Task 6 の session テスト。

---

### Task 1: `model.ts` に担当者を追加(純粋ロジック)

**Files:**
- Modify: `src/model.ts`
- Test: `src/model.test.ts`

**Interfaces:**
- Produces(T later tasks rely on): `Todo.assigneeId: string | null`、`TodoDraft.assigneeId: string | null`、`type AssigneeFilter = "any" | "none" | string`、
  `selectTodos(todos, filter, search, sort, now, assignee: AssigneeFilter)`(6引数化。5引数呼び出しは `"any"` 既定のオーバーロードなし — **全呼び出し箇所を6引数に更新する**)
- 新しい Filter 値は追加しない(担当者絞り込みは第6引数のみで扱う)。

- [ ] **Step 1: 壊れるテストを書く**

`src/model.test.ts` に追加:

```ts
it("selectTodos filters by assignee", () => {
  const todos = [mkTodo({ assigneeId: null }), mkTodo({ assigneeId: "u1" })];
  expect(selectTodos(todos, "all", "", "deadline", now, "none").map((t) => t.assigneeId)).toEqual([null]);
  expect(selectTodos(todos, "all", "", "deadline", now, "u1").length).toBe(1);
  expect(selectTodos(todos, "all", "", "deadline", now, "any").length).toBe(2);
});
```
(既存テストのヘルパー `mkTodo` 相当に `assigneeId: null` を含める。検索は notes/title/description のまま変えない)

- [ ] **Step 2: 失敗を確認** — Run: `npx vitest run src/model.test.ts` → FAIL(`assigneeId` が型にない)

- [ ] **Step 3: 実装** — `Todo` と `TodoDraft` に `assigneeId: string | null` を追加、`selectTodos` に第6引数 `assignee: AssigneeFilter` を追加し、filter 節で `any`=通す / `none`=`t.assigneeId === null` / その他=`t.assigneeId === assignee` を AND する。呼び出し箇所(`src/App.tsx`)は一時的に第6引数 `"any"` を渡す(ワイヤリングは Task 9)。

- [ ] **Step 4: 成功を確認** — `npx vitest run src/model.test.ts` → PASS、`npm test` → 全体 PASS

- [ ] **Step 5: Commit** — `✨ TODOモデルに担当者を追加`

### Task 2: API 共有型とクライアント検証

**Files:**
- Create: `src/cloud/types.ts`
- Create: `src/cloud/parse.ts`
- Test: `src/cloud/parse.test.ts`

**Interfaces:**
- Consumes: Task 1 の `Todo`(assigneeId 済み)
- Produces(全タスク共通の通信型;以下は exact):

```ts
// src/cloud/types.ts
import type { Todo } from "../model";
export type ActivityKind =
  | "todo.created" | "todo.updated" | "todo.deleted" | "todo.restored"
  | "user.joined" | "user.renamed" | "user.removed" | "list.renamed";
export interface CloudUser { id: string; name: string; createdAt: string }
export type CloudTodo = Todo; // assigneeId を含む拡張済み Todo
export interface Activity {
  id: string; todoId: string | null; userId: string | null;
  kind: ActivityKind; field: string | null;
  before: string | null; after: string | null; createdAt: string;
}
export interface CloudState {
  list: { id: string; title: string; revision: number };
  users: CloudUser[]; todos: CloudTodo[]; activities: Activity[];
}
export interface TodoPatch extends Partial<TodoDraft> {}
```

- Produces: `parseCloudState(input: unknown): CloudState` — 不正なら throw `Error(messages.errors.invalidState)`(messages に新キー `invalidState: "共有データを読み込めませんでした"` を追加)。

- [ ] **Step 1: 失敗するテスト**(`src/cloud/parse.test.ts`) — 正当データを通し、次を拒否する: revision非数 / users列でない / todoにassigneeId欠如 / status値がtodo|doing|done以外 / activityのkind不正 / deadlineがISO文字列ではなく数値。不正要素は**全体拒否**(fail-fast、部分採用しない)。

- [ ] **Step 2: 失敗を確認** — `npx vitest run src/cloud/parse.test.ts` → FAIL

- [ ] **Step 3: 実装** — `parse.ts` は手書きガード(`record`/`validDate` 相当を model.ts からエクスポートするか同型を再実装;重複を避けるため model.ts の内部ヘルパー `validDate` を export する)。`createdAt/updatedAt` 等は ISO 文字列として検証。

- [ ] **Step 4: PASS** — `npx vitest run src/cloud/parse.test.ts` + `npm test`

- [ ] **Step 5: package.json の format スクリプトに `src/cloud/types.ts src/cloud/parse.ts src/cloud/parse.test.ts` を追記して Commit** — `✨ クラウド通信型と検証ロジック`

### Task 3: DB スキーマと Neon 接続

**Files:**
- Create: `db/schema.sql`
- Create: `api/src/sql.ts`
- Modify: `tsconfig.json`(`include` に `"api"` を追加)

**Interfaces:**
- Produces: `db/schema.sql` は設計書 §データモデルの5テーブル(lists は token/revision を持つ、他は users、todos(+deleted_at)、memos、activities)。**status は 'todo'|'doing'|'done'**。加えて:

```sql
CREATE FUNCTION bump_list_revision() RETURNS trigger AS $$
BEGIN
  UPDATE lists SET revision = revision + 1
  WHERE id = COALESCE(NEW.list_id, OLD.list_id);
  RETURN NULL;
END $$ LANGUAGE plpgsql;
-- todos / memos / users / activities それぞれに、
-- AFTER INSERT OR UPDATE OR DELETE で bump_list_revision() を呼ぶトリガーを付ける。
-- 外部キーの削除挙動: activities.user_id / memos.user_id / todos.assignee_id / todos.created_by は ON DELETE SET NULL。
-- TODOは論理削除(行を消さない)なので、TODOに関する参照は CASCADE のままでよい。
```
(revision はトリガーで加算するため、アプリ側で履歴と本体を2文で書いても必ず1回以上は増える。重複加算は許容)

- Produces: `api/src/sql.ts`:

```ts
import { neon } from "@neondatabase/serverless";
export type Sql = (strings: TemplateStringsArray, ...values: unknown[]) => Promise<QueryResult>;
export type Transact = (statements: SqlCall[]) => Promise<void>;
export function makeDb(url: string): { sql: Sql; transact: Transact };
// sql: neon(url) をそのまま。transact: NeonTransaction API(neon.transaction(...)相当)をラップし、
// 「UPDATE todos…; INSERT activities…」のような複数文を1トランザクションにする。
```
- 依存追加: `@neondatabase/serverless`, `hono` を dependencies へ。tsconfig include に `api` を加え `npm run build` が型チェックする。

- [ ] **Step 1: 型エラーのない土台** — `api/src/sql.ts` を書き、`npx tsc -b` が通ることを確認(追加 import は `@neondatabase/serverless` のみ)。
- [ ] **Step 2: 依存インストール** — `npm i hono @neondatabase/serverless`
- [ ] **Step 3: 疎通確認(手動)** — READMEに「Neon devブランチURLを `DATABASE_URL` にして `psql "$DATABASE_URL" -f db/schema.sql を適用」の手順を追記(このタスクではドキュメントまで)。
- [ ] **Step 4: Commit** — `✨ 共有リストのDBスキーマとNeon接続`

### Task 4: API基本的なルート(作成・参加・取得・revision)

**Files:**
- Create: `api/src/domain.ts`(純ロジック: token生成・バリデーション・activity差分)
- Create: `api/src/app.ts`(Honoアプリ生成ファクトリ)
- Create: `api/index.ts`(Vercel ハンドラ;Interfaces のコード参照)
- Create: `api/src/domain.test.ts`(ユニット)
- Create: `api/src/app.test.ts`(統合; `TEST_DATABASE_URL` 未設定なら skip)

**Interfaces:**
- Consumes: Task 3 の `{ sql, transact }`
- Produces(全TaskのAPI体型):

```ts
export interface AppDeps { sql: Sql; transact: Transact }
export function createApp(deps: AppDeps): Hono;
// domain.ts(純関数・DOM 不要。テストは api/src/domain.test.ts)
export function generateToken(): string;         // 43文字 base64url(crypto.randomBytes(32))
export function assertText(v: unknown, max: number, field: string): string; // trim後1文字以上・<=max。違反は { status: 400 } で投げる
// 軸ラベル(status/priority の日本語化)は API では行わない。client 側(messages)で表示する。
// 「UPDATE todos …; INSERT activities …」のような複数文書き込みは transact([...]) を使う。
```
- **Create: `api/index.ts`** もこのタスクで作る。Vercel の関数ハンドラ: `import { handle } from "hono/vercel"` ルート定義をまとめた `createApp` の薄いラッパー:

```ts
import { handle } from "hono/vercel";
import { neon } from "@neondatabase/serverless";
import { createApp } from "./src/app";
import { makeDb } from "./src/sql";

const app = createApp(makeDb(process.env.DATABASE_URL!)); // makeDb の戻り値が AppDeps そのまま
export const GET = handle(app);
export const POST = handle(app);
export const PATCH = handle(app);
export const DELETE = handle(app);
```
- ルート(全 `/api` 配下。無効トークンは一律 404):

| 呼び出し | 応答 |
| --- | --- |
| `POST /api/lists` `{title, name}` | `{token}` (+作成者ユーザー登録) |
| `POST /api/lists/:token/join` `{name}` | `{userId, name}`(既存名なら再利用) |
| `GET /api/lists/:token` | `CloudState`(activities は全件、設計書どおり) |
| `GET /api/lists/:token/revision` | `{revision}` |

- [ ] **Step 1: domain の純粋テスト** — `generateToken()` が43文字・base64url集合・2回で異なる値。`assertText` が trim/上限/空文字で投げる。
- [ ] **Step 2: FAIL 確認** — `npx vitest run api/src/domain.test.ts`
- [ ] **Step 3: domain 実装、PASS 確認**
- [ ] **Step 4: app.test.ts(スキップ可能な統合)** — beforeAll で既存 rows を `DELETE FROM lists`。検証: 作成→token文字数43/取得でCloudState形状/revision は1かつ再取得で不変/存在しないトークンで404/存在しない名前 join で新規・既存名 join で同 userId。
- [ ] **Step 5: 実装(`app.ts`)** — Hono で4ルートのみ。join は1文で済ませる(`INSERT ... ON CONFLICT (list_id, name) DO NOTHING RETURNING ...` で既存再利用)。
- [ ] **Step 6: `TEST_DATABASE_URL` が環境変数にあれば実際に実行して PASS を確認。無ければスキップ表示になっていることだけ確認し、ユニットでタスク完了とする。**
- [ ] **Step 7: package.json format に api/src/\*.ts と db/schema.sql 追記して Commit** — `✨ 共有リストAPIの作成・参加・取得`

### Task 5: TODO CRUD + メモ + 活動記録

**Files:**
- Modify: `api/src/domain.ts`
- Modify: `api/src/app.ts`
- Test: `api/src/domain.test.ts`, `api/src/app.test.ts`

**Interfaces:**
- Produces(domain.ts):

```ts
export function computeActivities(
  before: CloudTodo,                                   // 変更前の値(オブジェクト)
  patch: TodoPatch,
  assigneeNameAfter: string | null,
): Array<{ field: string; before: string | null; after: string | null }>;
// 変化したフィールドだけ行を返す。priority/status/deadline は生値(machine readable)、
// assignee は名前文字列。title/descriptionも生値。
```
- Produces(app.ts へのルート):

| 呼び出し | 動作 |
| --- | --- |
| `POST /api/lists/:token/todos` `TodoDraft` | 作成 + `todo.created`。応答 `{id}` |
| `PATCH /api/lists/:token/todos/:id` `TodoPatch` | **変更フィールドのみ** activity を1行ずつ + revision 加算(トリガー)。応答 `{revision}` |
| `DELETE /api/lists/:token/todos/:id` | ソフト削除(`deleted_at`)+ `todo.deleted`(タイトルを before に格納)。既に削除済みでも 200(べき等)。存在しない id は 404 |
| `POST /api/lists/:token/todos/:id/restore` | `deleted_at = NULL` + `todo.restored`。応答 `{revision}` |
| `POST /api/lists/:token/todos/:id/memos` `{body}` | メモ挿入。対象が削除済みまたは存在しない場合は 404 |

- 読み取りは `GET /api/lists/:token` があわせて返す(todos は `deleted_at IS NULL` のみ、notes=memos を `Note` 形 `{id, text, createdAt}` で同梱)。PATCH では「assigneeId 変更」時だけ users を参照して名前に解決。

- [ ] **Step 1: domain 純粋テスト** — `computeActivities` の差分だけ返す(1フィールド/多フィールド/無変更=空配列/assigneeの名前化)。
- [ ] **Step 2: FAIL → 実装 → PASS**(`npx vitest run api/src/domain.test.ts`)
- [ ] **Step 3: app.test.ts(統合)** — (a) 作成→GET→todos[0] に `assigneeId: null`・`notes: []`。(b) 作成→PATCH(status と assignee)→revision が増え、activities に2行、before/after が期待値。(c) 同一todoへの連続2回 PATCH が両方 200(last-write-wins。Review Focus #1 をここで固定)。(d) DELETE→GET から消える→restore→GET に再び出る(メモは維持)。(e) ソフト削除済みTODOへのメモ送信は 404。
- [ ] **Step 4: 実装。PATCH は複数文(transact)で todo-update と activity-insert を同時。deleted_at トリガーの重複加算は許容(revision は単調増加なら正しい)**
- [ ] **Step 5: 統合 PASS 確認 → Commit** — `✨ TODOのCRUD・メモ・変更履歴API`

### Task 6: 管理操作 API + フロントセッション

**Files:**
- Modify: `api/src/app.ts`
- Create: `src/cloud/session.ts`
- Test: `api/src/app.test.ts`, `src/cloud/session.test.ts`

**Interfaces:**
- Produces(app.ts): `PATCH /api/lists/:token` `{title}`、`DELETE /api/lists/:token`(カスケード物理削除、確認は UI 側)、`PATCH /api/lists/:token/users/:id` `{name}`(重複は409)、`DELETE /api/lists/:token/users/:id`(担当中TODOのassignee=NULL化、activities/memos は userId を SET NULL 保持)。activities: `list.renamed`, `user.renamed`, `user.removed`。
- Produces(session.ts):

```ts
export interface Session { token: string; userId: string; name: string }
const SESSION_KEY = "hitotsuzutsu.session.v1";
export function readSession(): Session | null;              // 不正/欠如は null(×throw)
export function writeSession(s: Session | null): void;      // null=削除
export function tokenFromHash(): string | null;             // '#token=..' → 直後に履歴から消す(history.replaceState)
export function resolveSession(): { token: string | null; session: Session | null };
// hash トークンがあればそのトークンを優先(ユーザーは join 画面で確定)。なければ session.token。
```

- [ ] **Step 1: 統合テスト** — リネーム→GET で `list.title` 変化 + activity 追加。ユーザー削除→GET でそのメンバーの担当中 TODO の assignee が null になっている。リスト削除→GET 404。名前衝突 PATCH→409。
- [ ] **Step 2: session ユニットテスト(jsdom)** — 正常読み書き/削除。壊れたJSON→null(Review Focus #5)。`#token=` の抽出と `history.replaceState` 呼び出し(vi.spyOn(window.history))。
- [ ] **Step 3: FAIL→実装→PASS**
- [ ] **Step 4: formatスクリプト追記して Commit** — `✨ リスト・メンバー管理APIとセッション`

### Task 7: フロント同期層 — client と useBoard

**Files:**
- Create: `src/cloud/client.ts`
- Create: `src/cloud/useBoard.ts`
- Test: `src/cloud/client.test.ts`, `src/cloud/useBoard.test.ts`

**Interfaces:**
- Consumes: Task 2 の型・`parseCloudState`、Task 6 の session
- Produces(client.ts — 全て path は `/api` + token 付き、`ApiError { status }` をスロー):

```ts
export class ApiError extends Error { status: number }
createList(title: string, name: string): Promise<{ token: string }>
join(token: string, name: string): Promise<Session>
fetchState(token: string): Promise<CloudState>
fetchRevision(token: string): Promise<number>
createTodo(token: string, draft: TodoDraft & { assigneeId: string | null }): Promise<{ id: string }>
patchTodo(token: string, id: string, patch: TodoPatch): Promise<{ revision: number }>
deleteTodo(token: string, id: string): Promise<void>
restoreTodo(token: string, id: string): Promise<void>
sendMemo(token: string, todoId: string, body: string): Promise<void>
renameList(token: string, title: string): Promise<void>
deleteList(token: string): Promise<void>
renameUser(token: string, id: string, name: string): Promise<void>
removeUser(token: string, id: string): Promise<void>
```
- Produces(useBoard.ts):

```ts
export type Board =
  | { phase: "login"; sessionError?: string }     // session なし or 404 自動ログアウト後
  | { phase: "loading" }                          // 初回 fetch 中
  | { phase: "error"; message: string; retryable: true }
  | { phase: "ready"; state: CloudState; me: Session };
export function useBoard(session: Session | null, onSessionLost: () => void): Board & { refresh: () => void }
// - 初回 fetchState。ready 以降は interval 3000ms で fetchRevision →
//   revision > 自分の revision なら fetchState 再取得。
// - POLL_INTERVAL_MS = 3000 を export(テストから制御)。
// - 破壊的アクション(下)の後は fetchState を await で取り直し(返り値 revision ベースで新しい state)。
// - fetch が 404(ApiError)したら session を消し onSessionLost() を呼ぶ(phase: "login" に遷移)。
// - エラー文言は messages.errors を使用(コンポーネント直書きしない)。
```
- Produces(useBoard のアクション群(ready 時のみ): `addTodo`, `updateTodo`, `removeTodo`, `undoRemove`, `addMemo`, `renameBoard`, `removeBoard`, `renameMember`, `removeMember`, `setAssignee`(= updateTodo のショートカット)。

- [ ] **Step 1: client.test.ts** — `vi.stubGlobal("fetch", ...)` で (a) fetchState が parseCloudState を通す (b) fetchRevision で数値を返す (c) 404 応答で ApiError。(d) URL に token が含まれる。
- [ ] **Step 2: useBoard.test.ts**(jsdom + fake timers) — (a) ready 遷移と全データ保持 (b) revision 変化→fetchState 再取得 (c) revision 不変→再取得しない(Review Focus #4) (d) 404 で onSessionLost 発火(Review Focus #3) (e) addTodo → API 呼び出し後の再取得が反映。
- [ ] **Step 3: FAIL → 実装 → PASS**(`npm test` 全体 green)
- [ ] **Step 4: format スクリプト追記して Commit** — `✨ クラウド同期層(revisionポーリング)`

### Task 8: ログイン・参加画面

**Files:**
- Create: `src/screens/LoginScreen.tsx`
- Modify: `src/messages.ts`(新キーのみ)
- Test: `src/screens/LoginScreen.test.tsx`

**Interfaces:**
- Consumes: Task 7 の `createList` / `join`、Task 6 の `writeSession`
- Produces:

```tsx
export interface LoginScreenProps {
  prefillToken: string | null;              // resolveSession() から渡す(Task 6)
  onJoined(session: Session): void;
}
// 2モード: 「既存リストに参加する」/「新しいリストを作る」(タブ切替)。
// 参加モード: token(省略時 prefillToken 表示可) + ユーザー名。join() → writeSession → onJoined。
// 作成モード: リストtitle + self ユーザー名。createList() → join() → writeSession → onJoined。
// エラーはツールチップではなく、フォーム内の行として messages.errors 系の文言を表示する。
```
- messages 追加キー(初期値はこのとおり。実装者が読みやすく調整してよいが、追加は messages.ts へ): `login.{ heading:"共有TODOへ参加" joinTab joinToken joinName createTab createListTitle createListName joinAction createAction creating joining invalidToken duplicatedName }`
- errors: `errors.api.general`。

- [ ] **Step 1: コンポーネントテスト** — (a) 参加フロー成功: token入力→joinボタン→onJoined が Session で呼ばれる (b) prefillToken が既定値として入る(env: tokenFromHash は mock しない・prop で渡す) (c) 作成フローで createList+join が正の順で呼ばれる (d) join 失敗(404)に内容エラー表示、セッションそのものが書き換わらない。
- [ ] **Step 2: FAIL → 実装 → PASS → Commit** — `✨ 参加・作成のログイン画面`

### Task 9: App.tsx ワイヤリング(一覧・作成・編集・削除・取り消し)

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/ui.tsx`(カードに担当者チップ、TodoForm に担当者選択を足す程度)
- Modify: `src/messages.ts`
- Test: `src/App.test.tsx`(既存を書き換える)

**Interfaces:**
- Consumes: Task 7 の `useBoard`、Task 8 の LoginScreen
- Produces(挙動のみ;実装者は既存 App の構造をなるべく保全):
  - `useTodoStore` を外し、board を唯一のデータ源にする。App は `board.phase` で LoginScreen / ローディング / エラー(再試行ボタン) / 一覧を振り分ける。
  - 作成・編集(存在変更)・担当者変更 → `board` アクション → 再取得で確定。保存失敗時は入力を残して現在のエラー表示(既存UI流儀)。
  - 削除は既存確認ダイアログの後 `removeTodo` → 既存の toast+undo は restoreTodo を呼ぶ形。完了演出(`useCompletionQueue`)は API 応答成功後の自分操作のみ発火(既存の発火条件そのまま。内部のデータ源が board に変わる)。
  - **詳細モーダルは board.state の todos に id が無くなったら自動で閉じる(既存 effect の延長;Review Focus #2)**。
  - 完了演出・通知・Liquid Glass header・カレンダーリンクは触れない。
  - 絞り込み UI:既存フィルタ横に**担当者 select**(「すべて」/「担当者なし」/メンバー一覧、Task1 の AssigneeFilter を使う)。

- [ ] **Step 1: jsdom テストを board のスタブ(モジュールモック)に差し替える** — 既存 App テストの localStorage 読み替えに加え、以下を追加: 担当者 select で絞り込みが効く/削除→取り消しが restoreTodo を呼ぶ/詳細を開いたまま他人削除でモーダルが閉じる(mock の反映)。
- [ ] **Step 2: FAIL → App/ui 実装 → PASS**
- [ ] **Step 3: `npm run build` で型・未使用 import を含め緑**
- [ ] **Step 4: Commit** — `♻️ 一覧・作成・編集・削除をクラウド同期に接続`

### Task 10: 詳細モーダルのタイムライン(GitHub Issue 風)

**Files:**
- Create: `src/screens/Timeline.tsx`
- Modify: `src/ui.tsx`(TodoDetail 内に Timeline を配置)、`src/messages.ts`
- Test: `src/screens/Timeline.test.tsx`

**Interfaces:**
- Consumes: `Activity`、`Note`(memos)、STATUS/PRIORITY ラベル
- Produces:

```tsx
export interface TimelineProps {
  activities: Activity[]      // todoId が当該TODOのものを API 側で絞って渡す
  memos: Note[];
  users: CloudUser[];          // userId→name 解決
}
// memos と activities を createdAt で混ぜて時系列昇順。
// activity の行は「名前が field をbefore→afterへ変更」の形で messages.activity.line(kind,field,...) を通して生成。
// field=assignee は名前、status/priority は STATUS/PRIORITY、deadline は dateText(iso)。
```
- messages 追加(案;調整可): `activity.heading:"変更履歴"`、行組立関数 `activity.line(userName, kind, field, before, after)`(例:「田中が担当者を「—」から「佐藤」に変更しました」「田中が状態を未着手から進行中に変更しました」)、`activity.memoFallback`(userId消失時)。

- [ ] **Step 1: テスト** — (a) memo と activity が混在し createdAt 昇順 (b) status 変更行が「未着手→進行中」と日本語化される (c) assignee 変更行に操作者と両名が入る (d) userId が users に無い(削除済みメンバー)行もクラッシュせず fallback 文言。
- [ ] **Step 2: FAIL → 実装(messages の line 関数を先に)→ PASS → Commit** — `✨ 詳細に変更履歴タイムラインを追加`

### Task 11: 管理画面(リスト・メンバー)

**Files:**
- Create: `src/screens/ManageScreen.tsx`
- Modify: `src/messages.ts`、Task 9 の App に「管理」導線(view type: "manage")
- Test: `src/screens/ManageScreen.test.tsx`

**Interfaces:**
- Consumes: `renameBoard / removeBoard / renameMember / removeMember`(useBoard)
- Produces(挙動): 復元系の DataPanel に代わる管理アクセス点。操作は:
  - タイトル変更(保存アクション)
  - メンバー一覧(名前・作成日・担当中件数)+ 名前変更 + 削除(削除で対象が自分なら session 消去→ログイン後へ; App に `onSessionLost` を通す)
  - **リスト削除**:取り消し不可であること(`messages.manage.deleteListWarning`)を確認ダイアログで2段表示の後実行。実行後は login へ。
- token の表示・コピー(共有URLに `#token=` を付けた形の表示 + URLコピーボタン)は**この画面に置く**(Task 8 のログイン画面には置かない)。

- [ ] **Step 1: テスト** — (a) 名前変更で renameMember が呼ばれる (b) リスト削除は警告文言が見える状態で2回目の confirm で初めて呼ばれる(単一 confirm で発火しないこと) (c) tokenコピーURLが `#token=` 形。
- [ ] **Step 2: FAIL → 実装 → PASS → Commit** — `✨ リストとメンバーの管理画面`

### Task 12: DataPanel 縮小と JSON 書き出し

**Files:**
- Create: `src/cloud/export.ts`
- Modify: `src/DataPanel.tsx`(復元・一括削除機能を削り、書き出しのみへ)、`src/messages.ts`
- Test: `src/cloud/export.test.ts`(既存 `src/DataPanel.test.tsx`/`src/restore.test.ts` は該当機能テストの撤去)

**Interfaces:**
- Consumes: CloudState
- Produces:

```ts
// src/cloud/export.ts — 純粋(設計書の「クラウド版新フォーマット」)
export interface CloudExport {
  version: 2;
  exportedAt: string;                 // ISO
  list: { id: string; title: string };
  users: CloudUser[];
  todos: CloudTodo[];                 // notes 同梱、deleted_at は出さない(現値は有効を基準に)
  activities: Activity[];
}
export function buildCloudExport(state: CloudState, exportedAt: string): CloudExport;
export function serializeCloudExport(e: CloudExport): string;
```
- DataPanel: 書き出しボタン+件数表示のみへ書き換え(文言は「データの保存と復元」→「データの書き出し」)。`restore.test.ts` は削除、`DataPanel.test.tsx` は書き出しのテストに置き換え。**設計書どおり読み込み復元は廃止**(JSON入力 UI が残らないようにする)。

- [ ] **Step 1: export ユニットテスト** — (a) version 2・全4節入り (b) exportedAt 反映 (c) activities 昇順で含まれる。
- [ ] **Step 2: DataPanel 書き出しテスト** — クリックで投稿が Blob ダウンロードされ、コンテンツに version 2。
- [ ] **Step 3: DataPanel と model の整理** — 復元・一括削除機能は退役(replace/merge/add の `planRestore`・`mergeNotes`・`parseTodos`・`serializeTodos` と、それらのテスト部分を model.ts/model.test.ts から削除)。README での契約変更の記入は Task 13。DataPanel は書き出しボタン+件数表示のみに書き換え、`src/restore.test.ts` を削除、`src/DataPanel.test.tsx` を書き出しテストに置き換える。**読み込み復元の JSON 入力 UI は残さない**(設計書どおり)。
- [ ] **Step 4: format スクリプト追記して Commit** — `♻️ 復元を廃止し読み取り専用書き出しに`

### Task 13: 設定・README・ワークフロー・最終検証

**Files:**
- Modify: `README.md`(契約変更+技術構成マップ更新+Vercel/Neon手順)、`.github/workflows/pages.yml`(削除または用途明記)
- Modify: `.gitignore`(`.env.local` 的な DATABASE_URL ローカル置き)
- Create: `.env.example`(`DATABASE_URL=` のみ。コメント文: テスト用は Neon dev ブランチのURLを入れる)

**手順:**

- [ ] **Step 1: README更新** — (a)「保存と日時」章をクラウド版契約に書き換え(セッション/トークン・共有・リアルタイム・履歴) (b)「復元と一括削除」章を「書き出しのみ」へ (c)「Vercelへの公開」+「Neon セットアップ」(本番DATABASE_URLはユーザーが Vercel 環境変数に設定;接続文字列はコード・コミットに入れない) (d)「技術構成」ファイルマップ全更新(新ファイル全部)。
- [ ] **Step 2: pages.yml 判断** — 配信は Vercel 一本のため pages.yml を削除し、README の GitHub Pages 章も削除する(実装コードに pages 特有の参照が残っていないことを grep で確認)。
- [ ] **Step 3: 最終検証** — `npm test` 全 PASS / `npm run build` PASS / `npm run format` 実行して diff なし。
- [ ] **Step 4: Commit** — `📝 クラウド公開手順をREADMEへまとめPages構成を整理`

## 仕上げ(実装後、人間が行う)

1. Neon で dev ブランチを作り、`TEST_DATABASE_URL`(ローカル/CI)、本番用は Vercel の `DATABASE_URL` として設定。
2. `psql -f db/schema.sql` を dev・本番両方に適用。
3. Vercel Import → Deploy → 実ブラウザで2端末同時に開き、リアルタイム反映と履歴表示を確認。
