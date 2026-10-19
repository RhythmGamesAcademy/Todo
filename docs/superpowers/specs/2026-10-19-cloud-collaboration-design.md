# hitotsuzutsu クラウド共有版 設計

日付: 2026-10-19
状態: 承認待ち

## すでに決まっていること(話し合いで確定した選択)

- リアルタイム共有:全員で1つの共有 Todo リスト。担当者の割り当てを見せる。
- ログイン:共有トークン + ユーザー名。パスワード・OAuth は使わない。
- DB は **Neon**(PostgreSQL)、バックエンドは **Vercel**。ユーザーは両方のアカウントを既に持っており、本番用 `DATABASE_URL` はユーザー自身が Vercel の環境変数に設定する(接続文字列を AI に共有する必要はない)。
- 変更履歴:GitHub Issue 風に「いつ・誰が・何を変えたか」を時系列で見られる。
- 既存の localStorage データはテスト用なので引き継がない。
- 削除の取り消しは**維持する**(論理削除方式)。
- リスト・メンバーの管理操作(**タイトル変更・メンバー変更/削除・リスト削除**)は「全部やる」。ロールなしで全員が操作できる。

## 目的と背景

現在の hitotsuzutsu は localStorage に保存する個人用 TODO アプリで、データ共有は JSON バックアップの手動出し入れに依存している。業務のタスク管理(担当者の割り当てと進行状況の共有)に使いたいが、その運用は非現実的。

そこで、**全員で1つの共有 Todo リスト**を、複数人・複数端末からリアルタイムに近い形で操作できるクラウド版にする。あわせて、GitHub の Issue のように**変更履歴が時系列で見える**ようにする(誰が・いつ・優先度や担当者をどう変えたか)。

### 成功の条件

- メンバーがトークンとユーザー名だけで参加でき、JSON の読み書きが不要になる
- 誰かが追加・完了・担当者変更をすると、他のメンバーの画面に数秒以内に反映される
- 変更履歴(ステータス・優先度・期限・担当者の変更)とメモがタスクごとに時系列で見える
- 既存 UI(一覧・詳細モーダル・完了演出など)の操作感を大きく損なわない

### 非ゴール

- パスワード・OAuth によるユーザー認証、ロール・権限管理
- WebSocket による常時接続同期(ポーリングで近似する)
- オフライン編集と端末間の競合マージ(クライアントは常にサーバーに従う)
- 複数リストの管理 UI(仕組み上は複数リストを作れるが、画面は1リスト専用のまま)
- 多言語化(日本語のみのまま)
- 既存 localStorage データの移行(現在のデータはテスト用であり、引き継がない)

## 技術スタック(決定済み)

- **データベース: Neon**(サーバーレス PostgreSQL)。フォールバックは素の PostgreSQL だが、前提としては Neon を使う。
- **バックエンド: Vercel**(サーバーレス関数)。リポジトリ直下の `api/` ディレクトリに Node 関数を置く。現行の Vite + React 19 + TypeScript SPA はそのまま `dist` にビルドされ、API と同一オリジンで配信される。
- **フレームワーク: Hono**(Vercel Node ランタイム上)。1つのエントリポイントで複数ルートをまとめ、`api/` 配下のファイル数を最小にする。
- **DB アクセス: `@neondatabase/serverless`** の HTTP ドライバ(接続プールを使わない fetch ベース)。パラメータークエリ直書き。ORM は使わない。
- フロントの追加依存は原則なし(通信層は素の `fetch`)。

## アーキテクチャ

```
ブラウザ (React SPA)
  │  fetch (same-origin /api/*)
  ▼
Vercel Functions (Hono, Node)
  │  @neondatabase/serverless (HTTP)
  ▼
Neon PostgreSQL
```

リアルタイム性の実現方法:Vercel のサーバーレス関数は常時接続に向かないため、**リビジョン番号 + ポーリング**を使う。

- `lists` テーブルに `revision` カラムを持たせ、リスト内のデータを変えるすべての API が atomically に `revision = revision + 1` する。
- クライアントは開いている間、**約3秒間隔**で `GET /api/lists/:token/revision` を叩く(ごく軽い1行クエリ)。
- リビジョンが自分の知っている値より新しければ `GET /api/lists/:token` で **全データを再取得**し UI を再構築する。楽観的更新はせず、書き込みは API レスポンスで確定する。
- スケール感:想定は少数(小規模なチーム)。Hobby 無料枠で成立する量。

### 競合の扱い

- サーバーが唯一の正。書き込みは最後に行われた値フィールド単位で採用(last-write-wins)。
- クライアントでフォームを開いている間に他者が更新した場合、ポーリングで正しい値に置き換わる。編集フォーム送信時は「自分の編集開始時点の値」の上書きになるため、詳細モーダルは再取得時に**開いたまま値だけ差し替えず、閉じさせて再確認させる**(後述のUI方針)。
- 削除対象が既に無い場合などはべき等に成功扱いか、404 を返して UI に反映させる。

## データモデル

```sql
-- リスト(共有ボード)。トークンが参加資格そのもの。
CREATE TABLE lists (
  id          UUID PRIMARY KEY,
  token       TEXT NOT NULL UNIQUE,      -- 43文字以上のランダム文字列(URLコピー用に短めの公開IDは別途 id で持つ)
  title       TEXT NOT NULL,
  revision    BIGINT NOT NULL DEFAULT 0, -- リスト全体の更新カウンタ
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- リスト内ユーザー。認証は「トークンを知っている + ユーザー名を名乗る」。パスワードなし。
CREATE TABLE users (
  id         UUID PRIMARY KEY,
  list_id    UUID NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (list_id, name)
);

-- TODO(現行の Todo 型に担当者を追加した拡張)。削除は論理削除(取り消し維持のため)。
CREATE TABLE todos (
  id          UUID PRIMARY KEY,
  list_id     UUID NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status      TEXT NOT NULL,             -- 'todo' | 'doing' | 'done'(現行 model.ts の値と一致)
  priority    TEXT NOT NULL,             -- 'low' | 'medium' | 'high'
  due         TIMESTAMPTZ,               -- NULL = 期限なし。ISO 8601 で入力・表示(端末タイムゾーン)
  deleted_at  TIMESTAMPTZ,               -- NULL = 有効。削除直後の取り消しはこれを NULL に戻す
  assignee_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 詳細モーダルの送信のみメモ(現行仕様を維持:編集・削除なし)
CREATE TABLE memos (
  id         UUID PRIMARY KEY,
  todo_id    UUID NOT NULL REFERENCES todos(id) ON DELETE CASCADE,
  user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  body       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 変更履歴。メモ以外のすべての操作を記録する。TODO は論理削除なので行は残り、履歴が消えることはない。
-- before/after は人間が読める文字列(ユーザー名・タイトルなどはこの時点の文字列として焼き込む)。
CREATE TABLE activities (
  id         UUID PRIMARY KEY,
  list_id    UUID NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  todo_id    UUID REFERENCES todos(id) ON DELETE CASCADE, -- NULL = リスト単位の出来事
  user_id    UUID REFERENCES users(id) ON DELETE SET NULL,
  kind       TEXT NOT NULL,  -- 'todo.created' | 'todo.updated' | 'todo.deleted' | 'todo.restored'
                             -- | 'user.joined' | 'user.renamed' | 'user.removed'
                             -- | 'list.renamed' | 'list.deleted'(削除自体は記録後に物理削除されるため実装時確認)
  field      TEXT,           -- 'status' | 'priority' | 'due' | 'assignee' | 'title' | 'description' | 'name'
  before     TEXT,           -- 表示用に人間が読める文字列(仕上げ時点のプレゼンテーションはそのタイミングで確定するため)
  after      TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

不変条件(実装側で担保):

- `lists.revision` は、todos / memos / users / activities へのすべての書き込みと同一トランザクションで増える。
- ユーザー名はリスト内で一意。収集する個人情報はユーザー名のみ(メール・パスワードは保存しない)。
- 期限 `due` は ISO 8601 で保存し、UI は現行どおり端末のタイムゾーンで入力・表示する。
- TODO の削除は `deleted_at` を設定する論理削除。一覧・検索・件数などすべての通常クエリは `deleted_at IS NULL` を対象とする。「削除直後の取り消し」は同一 ID のまま `deleted_at` を NULL に戻す復元 API で成立する。
- メンバーの削除では、そのメンバーの担当 TODO の担当者を NULL にする。メモと履歴の表示は、`activities` / `memos` の文字列・ID 参照により削除前の名前を保つ。

## API 設計(案)

すべて `/api` 配下、Hono のルート。リクエストに無効なトークンがあれば一律 404 にする(リストの存在を漏らさない)。

| メソッド | パス | 用途 |
| --- | --- | --- |
| POST | `/lists` | 新規リスト作成 `{title, username}` → `{token, listId}`。作った本人はそのまま `users` に登録する。 |
| GET | `/lists/:token` | リスト全量 `{list, users, todos, memos, activities(直近N件), revision}` |
| GET | `/lists/:token/revision` | `{revision}`(ポーリング用の軽量クエリ) |
| POST | `/lists/:token/join` | `{username}` → 既存ユーザーならその ID を再利用(デバイスを変えても同じ名前で戻れる)。存在しなければ作成。 |
| POST | `/lists/:token/todos` | TODO 作成。`activities('todo.created')` を同一トランザクションで記録 |
| PATCH | `/lists/:token/todos/:id` | フィールド単位の部分更新。変更のあった各フィールドについて `activities('todo.updated')` を記録 |
| DELETE | `/lists/:token/todos/:id` | 論理削除 + `activities('todo.deleted')` |
| POST | `/lists/:token/todos/:id/restore` | 論理削除の取り消し(`deleted_at` を NULL へ)+ `activities('todo.restored')`。UI の削除直後の取り消しはこの API を叩く |
| POST | `/lists/:token/todos/:id/memos` | メモ送信(送信のみ・編集削除なしは現行仕様) |
| PATCH | `/lists/:token` | リストのタイトル変更。`activities('list.renamed')` を記録 |
| DELETE | `/lists/:token` | リストの削除。全メンバーのデータ(タスク・メモ・履歴)が物理削除される。UI 側で取り消し不能なことを明示した確認画面を挟む |
| PATCH | `/lists/:token/users/:id` | メンバー名の変更。`activities('user.renamed')` を記録 |
| DELETE | `/lists/:token/users/:id` | メンバーの削除(担当中の TODO の担当者は NULL 化)。`activities('user.removed')` を記録 |

- クライアント↔サーバー間は JSON。UUID はサーバー側で発行する。
- API キー・シークレットは Vercel の環境変数 `DATABASE_URL`(Neon のコネクション文字列)のみ。
- CORS は同一オリジンなので不要。

## フロントエンドの変化

現行コードで再利用する部分と、置き換える部分を明確にする。

**置き換える**

- `storage.ts`(localStorage 読み書き)→ `api.ts`(fetch クライアント)。セッション情報(トークン・ユーザー名・ユーザーID)だけは localStorage に保持して再訪時に自動再入場する。
- `DataPanel.tsx` のバックアップ復元フロー → クラウド版では不要(「JSONを読み込んで〜」という運用自体をなくすのがこの改修の目的)。機能の1代替として **JSON 書き出し(読み取り専用バックアップ)は残す**。

**維持する**

- `model.ts` の純粋ロジック(並べ替え・検索・期限判定・カレンダーURL生成)。バックアップ検証・直列化は書き出し用に残す。
- `messages.ts` に文言・文章構築を集約する原則(新しく追加される UI の文言もすべてここに)。新規文言も同様。新規の日時書式はここに追加。
- 詳細モーダル・完了演出(`completion/`)・ナビゲーションの描画や体験の設計。

**追加する**

- ログイン/参加画面:トークン(URL から `#token=` 等で受け取れるようにするのが望ましい)+ ユーザー名入力、または新規リスト作成かの選択。
- 詳細モーダルのタイムライン:GitHub Issue のように、**メモと変更履歴を混ぜた時系列**(メモ送信・ステータス変更・担当者変更などが1つの縦の流れに並ぶ)。変更履歴の各行には操作したユーザー名を表示する。項目の日本語文言は `messages.ts` に新規実装する。
- カードとヘッダー上の担当者表示(担当者名チップ)。絞り込みに「担当者」を追加する(現行の状態・期限系の絞り込みと同じ UI 文法)。
- リスト・メンバーの管理画面(決定済み:「全部やる」):リストタイトル変更、メンバー名の変更・削除、リストの削除。リスト削除は全員のデータが消えるため、取り消し不能であることを明示した確認画面を挟む。ロールはなく、これらは全員が操作できる。
- 同期受信時の反映:自分が詳細モーダルを開いたまま対象が書き換わった場合、閉じてから再確認する流れにする(勝手にフォーム内容が差し替わって誤入力を作らないため)。完了演出の発火条件も、自分の操作完了時のみに限定(既存仕様どおり)。

**配信**

- GitHub Pages はクラウド版の配信先から外す(API と同一オリジンでサーバー関数を立てられないため)。Pages 用の CI ワークフローを残すか削除するかは実装者がコードの実情を見て判断する。
- AGENTS.md の契約どおり、ファイルを追加・移動したら README.md の「技術構成」セクションのファイル責任マップを更新する。

## テスト方針

- `model.test.ts` など既存の純粋ロジックテストは壊さない。
- 追加純粋ロジックは `model.ts`(または新設の `src/api.test.ts` とペアのモジュール)に置き、DOM 不要でテストする:PATCH の差分 → activity の before/after 生成、ページングや並べ替えの再計算後の状態を含む API レスポンスの正規化など。
- Vercel 関数はロジック本体を `api/` 配下の純 TS モジュールに置き、Vitest でインポートして検証できる形にする(関数ハンドラは薄いラッパーに留める)。Hono のルートを supertest 相当(`app.request`)でテストする。
- DB 統合テストは、Neon の dev ブランチ URL が環境変数にあれば実行、無ければスキップとする(ローカル docker compose での代替も可とする方針は採らず、シンプルに「あれば走る」にする)。

## セキュリティとプライバシー

- 収集データ:ユーザー名のみ。トークンは推測不可能なランダム文字列(`crypto.randomBytes`)。
- トークンはクエリ文字列ではなく URL の fragment(`#`)または localStorage からのみ渡し、サーバーログに残さない。
- SQL はすべてプレースホルダ使用。文字列連結はしない。
- トークン入力ミスや無効トークンには一律 404 で返し、存在の有無を区別できない応答にする。

## 実装者に残す判断

- ラベル・絞り込み・担当者の UI の細部(配色やチップの見た目は現行の優先度表示の文法に寄せる想定)。
- タイムラインで表示する履歴の粒度(全部 vs 直近 N 件からたどる)。mix-in 表示は権限が1つなので簡単だが、古い履歴の扱いは仕上げ時の感覚で決めてよい。
- リージョンやプール運用など Neon 側の実運用設定。
- 既存 DataPanel をどの程度小さくするか(JSON 書き出しだけにする想定だが、文言・UI の流れは実装者が体験を損なわない形で)。
- `.github/workflows/pages.yml` を残すか外すか(用途が Vercel 一本になるなら外してよい)。

## 反対意見(アンチゴール)

たとえ技術的に可能でも、以下はしない:

- localStorage への新しいデータ保存(退行)。セッション情報以外を localStorage に置かない。
- ポーリング以外の同期機構を先に作る(WebSocket/SSE は将来の改善として別案に切り出す)。
- ユーザーごとの権限・ロール(全員がフル編集できる前提)。後で権限が必要になればトークンを管理者/メンバーの2種に増やす最小変更で済む設計に留める。
