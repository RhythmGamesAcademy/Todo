// ローカル開発用。API を Vercel 関数ではなく Node プロセスとして起動する。
// `npm run dev:api` から実行し、画面側は Vite の /api プロキシで接続する。
import { serve } from "@hono/node-server";
import { createApp } from "./src/app.js";
import { makeDb } from "./src/sql.js";
import { makeObjectStorageFromEnv } from "./src/object-storage.js";

const url = process.env.DATABASE_URL;
if (!url) {
  throw new Error(
    "DATABASE_URL が設定されていません。.env.local に Neon の接続文字列を記載してください。",
  );
}

const app = createApp({
  ...makeDb(url),
  objectStorage: makeObjectStorageFromEnv() ?? undefined,
});
const port = 3000;

serve(
  {
    fetch: app.fetch,
    port,
    // ローカル開発でもLANから叩けないよう、全インターフェースを開けない
    // (監査 L-004)。認証の無いAPIを 0.0.0.0 に置かない。
    hostname: "127.0.0.1",
  },
  () => {
    console.log(`API を http://127.0.0.1:${port} で起動しました。`);
  },
);
