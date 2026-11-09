# Codebase map: hitotsuzutsu (Todo)

- Owner: eng-codebase-map
- Language: task language not specified; repo comments, test names and commit summaries are Japanese, so this file is written in Japanese
- Status: draft
- Date: 2026-11-07
- Scope: root; 78 source files; measured with `map_codebase.py --root /mnt/c/Users/ryoxn/Documents/GitHub/Todo` (静的 import のみを計上。フレームワークの自動 import、動的 import、実行時注入は計上していない)

## Summary

共有TODOリスト「ひとつずつ(hitotsuzutsu)」。React 19 + TypeScript + Vite + Tailwind の静的SPA(クライアント)と、Hono + Vercel Functions のAPI(サーバ)の2系統で構成される。状態の唯一の保存先はサーバ側の Neon(Lakebase Postgres)で、フロントは 3 秒ごとのリビジョン差分ポーリングで同期する。セッション(list token + userId)のみ localStorage(`hitotsuzutsu.session.v1`)に置く。添付ファイルは Neon Object Storage(S3互換)に保存し、15 分期限の署名付き URL で配信する。API v1 はパスの token で対象リストを特定し、userId はリクエスト本文でクライアントが申告する。CI(Actions)は PR→mainと直接 push に対して `npm test` + `npm run build` を実行し、main への push は Vercel の Git 統合でそのままデプロイされる。

## Structure

```
src/            フロント本体(messages/model/storage/ui/DataPanel + cloud/completion/components/screens/notifications)
api/            Hono API(index.ts=Vercel / dev.ts=ローカルNode / src/=本体)
db/             schema.sql と migrations/001〜006
e2e/            Playwright(spec とモックAPI)
artifacts/      object storage の検証用 Node .mjs スクリプト(git 管理下)
public/         静的アセット
docs/           README用画像と2つの設計メモ(notification-tags-design.md / use-discord-cdn.md)
dist/           ビルド生成物(除外)
index.html      Vite 由来HTML。__APP_LOCALE__ 等を build 時に差し替え
vercel.json     /api/* の rewrite とセキュリティヘッダ(CSP 等)
```

## Stack

| Layer | Technology | Evidence |
|-------|------------|----------|
| UI | React 19.3 / lucide-react | package.json dependencies; `src/main.tsx:6-9` `createRoot(document.getElementById("root"))` |
| Style | Tailwind CSS 4.3(@tailwindcss/vite)+ 汎用CSS(src/index.css) | vite.config.ts:3,16 |
| API | Hono 4.13(hono/vercel + @hono/node-server) | api/index.ts:1-3, api/dev.ts:3, package.json |
| DB | Neon serverless driver(@neondatabase/serverless)on Lakebase Postgres | api/src/sql.ts:2,32 |
| Object storage | AWS SDK S3 クライアント(S3互換エンドポイント=Neon Object Storage) | api/src/object-storage.ts:1-7,92-103 |
| Build | Vite 8(tsc -b && vite build)、base "./" | package.json scripts; vite.config.ts:40 |
| Test | Vitest 5 + Testing Library + jsdom、E2E は Playwright | vite.config.ts:28-30, playwright.config.ts, package.json devDependencies |
| Deploy | Vercel(rewrite + CSP 等ヘッダ、Git 統合) | vercel.json:2-24, .github/workflows/ci.yml:2-6のコメント |

## Entry points and routes

| Entry | Path | What it starts |
|-------|------|----------------|
| Browser entry | index.html | `#root` に `src/main.tsx`(→ `src/App.tsx`)をマウント。SCRIPT タグは `/src/main.tsx`(index.html:14) |
| Build | vite.config.ts | プラグイン登録、`/api` を `VITE_API_URL`(既定 `http://127.0.0.1:3000`)へプロキシ(vite.config.ts:32-38)、`transformIndexHtml` で messages からロケール・タイトルを埋め込み(vite.config.ts:17-25、messages.ts:1) |
| API(本番) | api/index.ts | `createApp(...)` + `hono/vercel` の handle を GET/POST/PATCH/DELETE export(api/index.ts:11-14) |
| API(ローカル) | api/dev.ts | 同じ `createApp` を `@hono/node-server` で 127.0.0.1:3000 に起動(api/dev.ts:19-31) |

単一画面SPAで、`src/App.tsx:51-57` の `View` 型による状態駆動のモーダル切り替え(create/detail/edit/data/manage/notifications)。SPA 側にルーターファイルはなく、script の routes も空。API のルートは `api/src/app.ts` 内の Hono ルート定義(ファイル 1,682 行、本パスでは 1-70 行目と主な依存のみ確認)。

## Components

| Component | Files | Location | Script module | Imported by (afferent) | Imports (efferent) | Responsibility |
|-----------|-------|----------|---------------|------------------------|--------------------|----------------|
| アプリ シェルとドメイン | src/main.tsx, App.tsx, ui.tsx, model.ts, messages.ts, storage.ts, DataPanel.tsx | src/ 直下のファイル群 | (root files) | 6(cloud, completion, components, e2e, notifications, screens) | 5(cloud, completion, components, notifications, screens) | 画面構成・状態ハンドリング、TODO ドメイン型と選択関数(model.ts)、日本語 UI 文言(messages.ts、551 行)、一時的な UI 状態(storage.ts の `todo:layout`) |
| クラウド同期 | src/cloud/(client, useBoard, session, types, parse, export)11 ファイル | src/cloud/ | cloud | 5((root files), api, e2e, notifications, screens) | 1((root files)) | REST クライアント(client.ts)、3 秒ポーリングの Board フェーズ管理(useBoard.ts:33 `POLL_INTERVAL_MS = 3000`)、localStorage セッション(session.ts)、応答の検証(parse.ts)、エクスポート生成(export.ts、DataPanel から使用) |
| 共有UIコンポーネント | src/components/(AttachmentList/Preview/Uploader, FileAttachment, TodoLayoutIcon, TodoNavigation, TodoStatusBadge, VideoPlayer) | src/components/ | components | 2((root files), screens) | 1((root files)) | ナビゲーション・ステータス・添付系の部品 |
| 完了アニメーション | src/completion/ 18 ファイル(SeaLion, AnimationSession, geometry, queue など) | src/completion/ | completion | 1((root files)) | 1((root files)) | 完了時の演出。App から useCompletionQueue と CompletedCelebration/Notice で利用(App.tsx:48-50) |
| 画面 | src/screens/(LoginScreen, ManageScreen, Timeline) | src/screens/ | screens | 1((root files)) | 3((root files), cloud, components) | 参加/作成(LoginScreen)、リスト・メンバー管理と共有URL生成(ManageScreen.tsx:37-42)、変更履歴(Timeline) |
| 通知パネル | src/notifications/NotificationPanel.tsx(+test) | src/notifications/ | notifications | 1((root files)) | 2((root files), cloud) | 自分宛通知の一覧表示 |
| API サーバ | api/index.ts, api/dev.ts, api/src/(app, domain, attachment, object-storage, rate-limit, sql) | api/ | api | 1(artifacts) | 1(cloud: src/model.ts と src/cloud/types の型 import) | リスト/TODO/メモ/添付の REST、レートリミット、スキーマ・オブジェクトストレージ接続 |
| 運用スクリプト | artifacts/check-object-storage.mjs, presign-check.mjs, storage-test.mjs, vercel-env-sync.mjs | artifacts/ | artifacts | 0 | 1(api) | object storage の動作検証と Vercel env 同期(shell 実行用) |
| E2E | e2e/board.spec.ts, e2e/mockApi.ts | e2e/ | e2e | 0 | 2((root files), cloud) | Playwright 用のモック API(mockApi.ts:1-5 の説明、`/api/**` を page.route で横取り) |

Afferent/Efferent 数は `map_codebase.py` の `modules` 出力からの転記。計上は静的 import のみ(フレームワークの自動 import、動的 import、実行時注入は対象外)。テストファイル(`*.test.ts(x)`)は各モジュールの file 数に含まれる。「アプリ シェルとドメイン」は script のモジュール `(root files)`(15 ファイル、ルート直下ファイルを含む)のうち src 直下の部分で、モジュール全体の数値をそのまま載せている。

結合度の高いファイル(src/cloud/types.ts:20 importers、src/model.ts:21、src/messages.ts:32 は script の top_files_by_afferent より。これらは (root files) と cloud の両モジュールにまたがる)。循環依存: (root files) ⇄ cloud((root files) が cloud を imports、cloud が (root files) を imports — script modules 出力)。

## Main paths

### 参加/作成 → セッション確立
1. index.html:14 — `/src/main.tsx` を読み込む
2. src/main.tsx:3-9 — `<App />` をマウント; src/App.tsx:62-72 — `resolveSession()`(src/cloud/session.ts:81-89)が localStorage セッションと URL ハッシュの `#token=` 読み取り、ハッシュは即座に履歴から消す(session.ts:67-79)
3. src/App.tsx:379-391 — `board.phase === "login"` で LoginScreen を表示; src/screens/LoginScreen.tsx:41-58 — `join()` 呼び出し(→ client.ts:99 `POST /api/lists/:token/join`)
4. api/index.ts:6-9 → api/src/app.ts — Hono ルートが処理(`generateToken()` は api/src/domain.ts:25-27)
5. 外部呼び出し — neon serverless driver で Postgres へ SQL 実行(api/src/sql.ts:35-38); 結果は `writeSession()`(src/cloud/session.ts:45-53)で localStorage `hitotsuzutsu.session.v1` に保存

### ボード同期(ポーリング)
1. src/App.tsx:85 — `useBoard(currentSession, onSessionLost)`
2. src/cloud/useBoard.ts:142-154 — 初回 `fetchState(token, userId)`; :156-168 — 3 秒ごとに `fetchRevision`(client.ts:118 `GET /api/lists/:token/revision`)で差分検知し、revision が進んでいれば `fetchState` で全体を取得。古い応答は revision 比較で破棄(:147,:162)
3. src/cloud/client.ts:108 — `GET /api/lists/:token?userId=` を fetch;
4. api/src/app.ts — Hono ルートが `lists/todos/subtasks/notes/users` 等を SQL で読む(sql.ts:35-38 経由)
5. src/cloud/parse.ts — `parseCloudState` が応答を検証して `CloudState`(src/cloud/types.ts:60-67)
6. src/App.tsx:180-183 — `selectTodos`(src/model.ts)で絞り込み・ソートし、src/ui.tsx の `TodoCard`/`TodoDetail` が描画(本パスでは ui.tsx は行数確認のみ、参照箇所は App.tsx:42 の import)

### TODO 完了とアニメーション
1. src/App.tsx:240-257 `updateTodo()` — `board.updateTodo`(useBoard.ts)経由で client.ts `patchTodo`(client.ts:137)から PATCH を送る; DB 更新は api/src/app.ts → sql.ts
2. 成功したら src/App.tsx:253 — `completion.enqueue(...)`(src/completion/useCompletionQueue.ts:6-45 — 完了済みのみを queue に残し、`target`/`counter` の DOM 要素参照(:20-21)と `onPrepare` で完了タブへ切替(:31-39)を測定前に行う)
3. src/App.tsx:886-894 — `completion.current` があれば `CompletionCelebration`(src/completion/CompletionCelebration.tsx)を表示、完了後は :895-901 で `CompletionNotice`。演出の幾何計算は src/completion/swimGeometry.ts / seaLionShape.ts / completionMotion.ts(本パスでは未精読)

### 添付ファイル
1. src/App.tsx:744-770 — TodoDetail の `onAddAttachment` → `board.addTodoAttachment` / `onRemoveAttachment` → `board.removeAttachment`
2. src/cloud/client.ts:319,413 — `uploadTodoAttachment`(multipart)/`deleteAttachment`
3. api/src/app.ts — api/src/attachment.ts の検証(拡張子+MIME+マジックナンバー、上限 3MiB、1 TODO 50 件:attachment.ts:7-11)
4. 外部呼び出し — api/src/object-storage.ts:38-55 `put()`、:57-80 `signedUrl()`(900 秒期限、inline 表示は画像・動画・テキストのみ、:14-16,72-76)

## Integration points

| System | Where | Purpose | Configured by |
|--------|-------|---------|---------------|
| Neon(Lakebase Postgres) | api/src/sql.ts:32 `neon(url, { fullResults: true })`; 接続元は api/index.ts:7 と api/dev.ts:8-18 | リスト・TODO・メモ・通知・添付メタデータの全永続化; スキーマは db/schema.sql + db/migrations/001〜006 | `DATABASE_URL`(api/dev.ts, api/index.ts; script integration_signals) |
| Neon Object Storage(S3互換) | api/src/object-storage.ts:89-104 `makeObjectStorageFromEnv` — put/signedUrl/delete | 添付ファイル本体の保存と配信 | `NEON_STORAGE_ENDPOINT` / `NEON_STORAGE_BUCKET` / `NEON_STORAGE_ACCESS_KEY_ID` / `NEON_STORAGE_SECRET_ACCESS_KEY` / `NEON_STORAGE_REGION`(object-storage.ts:92-103) |
| Google Calendar リンク生成 | src/model.ts:304-324 `calendarUrl()` | 期限付き TODO の「予定を追加」URL 作成(ブラウザ側リンクであり、API 呼び出しではない) | コード内固定 URL(`calendar.google.com/calendar/render`,model.ts:321-322) |
| Vercel | vercel.json:2 rewrite `/api/(.*)` → `/api/index`; :4-24 CSP 等のヘッダ; .github/workflows/ci.yml:2-6 のコメント | サーバレス代行とセキュリティヘッダ、main push でデプロイ | vercel.json、Vercel ダッシュボード(コメント記載の Firewall 等) |
| Vite dev プロキシ | vite.config.ts:32-38 | ローカル開発時に `/api` を API プロセスへ中継 | `VITE_API_URL`(既定 `http://127.0.0.1:3000`) |

## Security boundaries

- 信頼できない入力が入る場所: ブラウザ → `src/cloud/client.ts`(fetch)、URL ハッシュの `#token=`(src/cloud/session.ts:67-79)、UI フォーム → API の本文。サーバ側の検証は api/src/domain.ts(`parseTags` :33-53、400 強制)、api/src/attachment.ts(MIME/マジックナンバー、サイズ)、api/src/rate-limit.ts(429)が担う。API では `clientIp`(x-forwarded-for、rate-limit.ts:54-56)をキーに計数。
- 秘密が読まれる場所: `process.env.DATABASE_URL`(api/index.ts:7、api/dev.ts:8、sql.ts:56 で SHA-256 指紋化)と `NEON_STORAGE_*`(object-storage.ts:92-96)。クライアント側の localStorage にはセッション token/userId/name のみ(src/cloud/session.ts:1-7)。.env.local は `dev:api` スクリプト(package.json)が参照。
- サーバで動くもの: api/(Hono、SQL、署名付き URL 生成、レートリミット)。ブラウザで動くもの: src/ 全体(状態はサーバの CloudState + localStorage セッション)。
- 公開面: 静的 SPA 全体(base"./"、vercel.json)、および `/api/*`(vercel.json:2)。API v1 は bearer 等の認証ヘッダをもたず、対象リストはパスの token、userId は本文の申告値で、その扱いは client.ts:21-22 のコメントに明記(server 側は app.ts のルート定義で処理、本パスでは確認未了)。
- ヘッダ/配信: vercel.json:9 の CSP(`connect-src 'self' https://*.neon.tech`)、ストレージの inline 配信は危険な形式を `attachment` に強制(object-storage.ts:72-76、attachment.ts の `isInlineRenderable`)。

## セキュリティ上の受け入れリスク

設計判断として現状受け入れているリスク。いずれも API v1 の制約に由来する。

- 共有トークンが唯一の認証要素: トークンは `randomBytes(32)` の base64url(32バイト、api/src/domain.ts:25-27)で、パスの token が対象リストを特定する。リスト内の全操作(リスト削除を含む)がこのトークンのみで実行でき、招待リンクは共有 URL(`#token=`)として経由し続ける。トークン失効・ローテーション API は未提供のため、流出時はリスト削除での対応になる。トークン再発行エンドポイントの追加は将来の課題。
- `userId` のクライアント任意送信: API v1 には認証済み呼び出し元の概念がなく、`userId` はリクエスト本文の申告値(client.ts:21-22)。トークン保持者はリスト内メンバーとしての帰属(変更履歴・通知)を偽装できる。server-side セッションの導入時に解消予定。
- セッショントークンの localStorage 保存: セッション(token/userId/name)は localStorage `hitotsuzutsu.session.v1` に保存され(src/cloud/session.ts:1-7)、XSS が成立すると露出する。CSP `script-src 'self'`(vercel.json:9)で外部スクリプト実行を絞ることで緩和している。
- CSP の `style-src 'unsafe-inline'`: React のインラインスタイル利用に必要なため許可している(vercel.json:9)。

詳細は監査レポート `security-audit-report-2026-11-08.md`(L-006/L-007)を参照。レポートファイル自体は .gitignore 済みのためリポジトリには含めない。

## Observations

- (root files) と cloud が互いに import する(script modules 出力: (root files) imports cloud、cloud imports (root files))。cloud の api 依存は型 import のみ(api/src/app.ts:4-23 が src/model と src/cloud/types の型を import、module 出力では api → cloud)。
- 定数が同一の値・規約で二重定義されている: `REQUEST_TAG="申請"` / `MAX_TAGS=5` / `MAX_TAG_LENGTH=20` が src/model.ts:10-13 と api/src/domain.ts:4-7 にあり、双方に「揃える」旨のコメント(src/model.ts:10、api/src/domain.ts:4)。類似の補助として src/model.ts:331-334 に `cleanTags`(UI 用)と `parseTags`(API 用)の同一規則コメント。
- API v1 が保たない境界の性質はコードに明記: client.ts:「API v1 は呼び出し元を認証しないため、現在のセッションの userId を本文に添える」(client.ts:21)、トークン不一致のセッションには userId を付けない(client.ts:23-31)。
- レートリミットはインメモリ・固定窓、`MAX_KEYS=10_000`、計数はインスタンス単位でベストエフォートという条件をレートリミット自身のコメントが宣言(api/src/rate-limit.ts:3-10,27)。
- artifacts/ は AGENTS.md に「無視される作業領域」と記載されているが、実際には git 管理下で 4 つの .mjs を含み(`git ls-files artifacts` = check-object-storage/presign-check/storage-test/vercel-env-sync.mjs、上記で確認)、presign-check.mjs が fetch(records 統合 signals)と api モジュールへの依存(script)を持つ。
- docs/use-discord-cdn.md(存在: root の docs 一覧)と db/migrations/006_remove_discord_storage.sql(存在: db/migrations 一覧)は、かつての Discord CDN 保存先が撤去されたことの痕跡。vercel.json:9 の CSP は現在 `https://*.neon.tech` を許可している。
- 同期はポーリングのみ: useBoard.ts:33 `POLL_INTERVAL_MS = 3000`(WebSocket/SSE はコードに見つからず)。
- 最大ファイル: api/src/app.ts 1,682 行、src/ui.tsx 1,650 行(`wc -l` より)。両者は root と cloud/components をつなぐ中心的な実装位置。
- テストもモジュール構成に沿って配置: src/・api/・e2e/ に計 74 の .test ファイル群(script tree by_extension .ts 45 等)と最新の分が src/cloud/parse.useBoard などの対置(tests sit beside modules、AGENTS.md の記載と一致)。
- ローカル API は 127.0.0.1 に限定(api/dev.ts:21-28、コメントは監査 L-004 を引用); E2E はモックAPIで DB なしで動く(e2e/mockApi.ts:1-5、src/cloud/parse.ts の検証と SESSION_KEY を使い回す:6)。
- AGENTS.md(ルート)は「Conventional Commits の慣例は確立していない」と記述するが、git log は `ci(actions): ...` / `fix(cloud): ...` 型の Conventional Commits 形式の履歴を示す(git log --oneline -3 の実行結果)。
- `security-audit-report-2026-10-25.md` と `security-audit-report-2026-11-06.md` がルートに存在(docs_at_root 出力)。レートリミットと CI のコメントは 2026-11-06 監査の M-003/M-002 を参照(api/src/rate-limit.ts:4、ci.yml:2-6)。このマップは監査レポートの中身を読んでいない。

## Files read

- vite.config.ts — entry/config: プラグイン、プロキシ、Tailwind、html 差し替え
- index.html — ブラウザ entry
- src/main.tsx — React マウント
- src/App.tsx(全 939 行)— 画面構成、updateTodo/dirty/confirm などの主要動線
- src/model.ts(1-70, 300-345)— ドメイン型、calendarUrl、cleanTags
- src/messages.ts(1-40)— 文言辞書の先頭
- src/storage.ts — `todo:layout` の localStorage
- src/DataPanel.tsx — エクスポート導線(cloud/export を使用)
- src/cloud/client.ts(1-80 + 関数一覧 grep)— REST client、userId 申告の箇所
- src/cloud/useBoard.ts(1-90, 115-174)— ポーリング Board フェーズ
- src/cloud/session.ts(全)— localStorage セッションと `#token=` 解決
- src/cloud/types.ts(全)— CloudState/patch 型
- src/cloud/export.ts(全)— バックアップ書き出し
- src/screens/LoginScreen.tsx(1-60)— 参加/作成フォーム
- src/screens/ManageScreen.tsx(1-50)— リスト・メンバー管理と共有URL
- api/index.ts(全)— 本番 entry
- api/dev.ts(全)— ローカル entry(127.0.0.1 限定)
- api/src/app.ts(1-70)— 依存と AppDeps
- api/src/sql.ts(全)— neon() driver、transact、describe
- api/src/object-storage.ts(全)— S3クライアント、env 読み取り
- api/src/domain.ts(1-60)— REQUEST_TAG, parseTags, token 生成
- api/src/rate-limit.ts(全)— 固定窓レートリミッタ
- api/src/attachment.ts(1-60)— 添付形式・上限
- db/schema.sql(1-40)— lists/users/todos 表
- vercel.json(全)— rewrite とセキュリティヘッダ
- .github/workflows/ci.yml(全)— CIgates
- e2e/mockApi.ts(1-40)— E2E モック API
- src/completion/useCompletionQueue.ts(1-45)— 完了 queue と target 要素
- 一覧取得: src/・api/・db/・docs/・e2e/・artifacts/ の `ls`、`find src -maxdepth 1`、`wc -l`、`git ls-files artifacts e2e`、`git status --short --untracked-files=all`

## Assumptions

- Assumption: script モジュール `(root files)` の 15 ファイルは、ルート直下の設定ファイル群と src/ 直下のファイル群を合わせて集計している(ファイル単位の内訳は script 出力に載っていないため、コンポーネント表では src 直下の部分のみ掲げた)。
- Assumption: api/src/app.ts は 1-70 行目と依存読み込みのみで、全ルートの網羅確認をしていない(そのため、API ルート一覧は client.ts の関数と vercel.json の rewrite から構成)。
- Assumption: 「アニメーションの幾何計算」や src/ui.tsx の詳細は、未読のファイルを指して「本パスでは未精読」と明示している(数値・動作の主張はしていない)。
