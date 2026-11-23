import { createRequire } from "node:module";
import { neon } from "@neondatabase/serverless";
import type { QueryResult } from "@neondatabase/serverless";

export type Sql = ((
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<QueryResult>);

export type SqlCall = Promise<QueryResult> & {
  __pgQuery?: { text: string; values: unknown[] };
  __pgSettle?: (result: QueryResult) => void;
  __pgReject?: (err: unknown) => void;
  __pgStarted?: boolean;
};

export type Transact = (statements: SqlCall[]) => Promise<QueryResult[]>;
export type TransactGuarded = (
  lockKey: string,
  statements: SqlCall[],
  guardedStatementIndex: number,
) => Promise<boolean>;
export type DbInfo = {
  database: string;
  user: string;
  schema: string;
  searchPath: string;
  lists: number;
};
export type Describe = () => Promise<DbInfo>;
export type Db = {
  sql: Sql;
  transact: Transact;
  transactGuarded: TransactGuarded;
  describe: Describe;
};

const isLocalHost = (hostname: string): boolean =>
  hostname === "localhost" ||
  hostname === "127.0.0.1" ||
  hostname === "::1" ||
  hostname === "[::1]";

const shouldUsePg = (url: string): boolean => {
  try {
    return isLocalHost(new URL(url).hostname);
  } catch {
    return false;
  }
};

type PgPool = import("pg").Pool;
type PgQueryResult = import("pg").QueryResult<Record<string, unknown>>;

const toQueryResult = (result: PgQueryResult): QueryResult =>
  ({
    command: result.command,
    rowCount: result.rowCount ?? result.rows.length,
    rows: result.rows,
    fields: result.fields.map((f) => ({ name: f.name, dataTypeID: f.dataTypeID })),
  }) as unknown as QueryResult;

const compileTemplate = (
  strings: TemplateStringsArray,
  values: unknown[],
): { text: string; values: unknown[] } => {
  let text = "";
  for (let i = 0; i < strings.length; i += 1) {
    text += strings[i];
    if (i < values.length) text += `$${i + 1}`;
  }
  return { text, values };
};

const makePgDb = (url: string): Db => {
  let PoolCtor: typeof import("pg").Pool;
  try {
    const req = createRequire(import.meta.url);
    PoolCtor = (req("pg") as typeof import("pg")).Pool;
  } catch (err) {
    throw new Error(
      "ローカルPostgres接続には pg パッケージが必要です。`npm install -D pg @types/pg` を実行してください。",
      { cause: err },
    );
  }

  const pool: PgPool = new PoolCtor({ connectionString: url });

  const sql: Sql = ((strings: TemplateStringsArray, ...values: unknown[]): SqlCall => {
    const query = compileTemplate(strings, values);
    let settled = false;
    let resultValue: QueryResult | undefined;
    let errorValue: unknown;
    let resolveFn: ((v: QueryResult) => void) | undefined;
    let rejectFn: ((e: unknown) => void) | undefined;

    const promise = new Promise<QueryResult>((resolve, reject) => {
      resolveFn = resolve;
      rejectFn = reject;
      if (settled) {
        if (errorValue !== undefined) reject(errorValue);
        else resolve(resultValue as QueryResult);
      }
    }) as SqlCall;

    const startOnPool = () => {
      if (settled || promise.__pgStarted) return;
      promise.__pgStarted = true;
      pool
        .query<Record<string, unknown>>(query.text, query.values)
        .then(toQueryResult)
        .then(
          (r) => {
            if (settled) return;
            settled = true;
            resultValue = r;
            resolveFn?.(r);
          },
          (e) => {
            if (settled) return;
            settled = true;
            errorValue = e;
            rejectFn?.(e);
          },
        );
    };

    const originalThen = promise.then.bind(promise);
    (promise as any).then = (onFulfilled: any, onRejected: any) => {
      if (!settled && !promise.__pgStarted) startOnPool();
      return originalThen(onFulfilled, onRejected);
    };
    const originalCatch = promise.catch.bind(promise);
    (promise as any).catch = (onRejected: any) => {
      if (!settled && !promise.__pgStarted) startOnPool();
      return originalCatch(onRejected);
    };
    const originalFinally = promise.finally.bind(promise);
    (promise as any).finally = (onFinally: any) => {
      if (!settled && !promise.__pgStarted) startOnPool();
      return originalFinally(onFinally);
    };

    promise.__pgQuery = query;
    promise.__pgSettle = (r: QueryResult) => {
      if (settled) return;
      settled = true;
      resultValue = r;
      resolveFn?.(r);
    };
    promise.__pgReject = (e: unknown) => {
      if (settled) return;
      settled = true;
      errorValue = e;
      rejectFn?.(e);
    };
    return promise;
  }) as Sql;

  const transact: Transact = async (statements) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const results: QueryResult[] = [];
      for (const statement of statements) {
        const q = (statement as SqlCall).__pgQuery;
        if (!q) {
          throw new Error("pgトランザクションには db.sql`...` で生成したクエリを渡してください。");
        }
        (statement as SqlCall).__pgStarted = true;
        const result = await client.query<Record<string, unknown>>(q.text, q.values);
        const qr = toQueryResult(result);
        (statement as SqlCall).__pgSettle?.(qr);
        results.push(qr);
      }
      await client.query("COMMIT");
      return results;
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        /* ignore rollback failure */
      }
      for (const s of statements) (s as SqlCall).__pgReject?.(err);
      throw err;
    } finally {
      client.release();
    }
  };

  const transactGuarded: TransactGuarded = async (
    lockKey,
    statements,
    guardedStatementIndex,
  ) => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [lockKey]);
      const results: QueryResult[] = [];
      for (const statement of statements) {
        const q = (statement as SqlCall).__pgQuery;
        if (!q) {
          throw new Error("pgトランザクションには db.sql`...` で生成したクエリを渡してください。");
        }
        (statement as SqlCall).__pgStarted = true;
        const result = await client.query<Record<string, unknown>>(q.text, q.values);
        const qr = toQueryResult(result);
        (statement as SqlCall).__pgSettle?.(qr);
        results.push(qr);
      }
      await client.query("COMMIT");
      const guarded = results[guardedStatementIndex];
      return (guarded?.rowCount ?? 0) > 0;
    } catch (err) {
      try {
        await client.query("ROLLBACK");
      } catch {
        /* ignore rollback failure */
      }
      for (const s of statements) (s as SqlCall).__pgReject?.(err);
      throw err;
    } finally {
      client.release();
    }
  };

  const describe: Describe = async () => {
    const result = await sql`
      SELECT current_database() AS database,
             current_user AS user,
             current_schema() AS schema,
             current_setting('search_path') AS search_path,
             (SELECT COUNT(*)::int FROM information_schema.tables
              WHERE table_schema = 'public' AND table_name = 'lists') AS lists
    `;
    return result.rows[0] as DbInfo;
  };

  return { sql, transact, transactGuarded, describe };
};

const makeNeonDb = (url: string): Db => {
  const query = neon(url, { fullResults: true });
  const sql: Sql = ((strings, ...values) =>
    query(strings, ...values) as unknown as Promise<QueryResult>) as Sql;
  const transact: Transact = (statements) =>
    (query as unknown as { transaction: (q: unknown[]) => Promise<QueryResult[]> }).transaction(
      statements as unknown as unknown[],
    );
  const transactGuarded: TransactGuarded = async (
    lockKey,
    statements,
    guardedStatementIndex,
  ) => {
    const lock = sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))` as unknown as SqlCall;
    const results = await (query as unknown as { transaction: (q: unknown[]) => Promise<QueryResult[]> }).transaction(
      [lock, ...statements] as unknown as unknown[],
    );
    return (results[guardedStatementIndex + 1]?.rowCount ?? 0) > 0;
  };
  const describe: Describe = async () => {
    const result = await sql`
      SELECT current_database() AS database,
             current_user AS user,
             current_schema() AS schema,
             current_setting('search_path') AS search_path,
             (SELECT COUNT(*)::int FROM information_schema.tables
              WHERE table_schema = 'public' AND table_name = 'lists') AS lists
    `;
    return result.rows[0] as DbInfo;
  };
  return { sql, transact, transactGuarded, describe };
};

export const makeDb = (url: string): Db =>
  shouldUsePg(url) ? makePgDb(url) : makeNeonDb(url);
