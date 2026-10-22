import { createHash } from "node:crypto";
import { neon } from "@neondatabase/serverless";
import type {
  FullQueryResults,
  NeonQueryPromise,
  QueryResult,
} from "@neondatabase/serverless";

export type Sql = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<QueryResult>;
export type SqlCall = ReturnType<Sql>;
export type Transact = (statements: SqlCall[]) => Promise<void>;
export type DbInfo = {
  urlFingerprint: string;
  database: string;
  user: string;
  schema: string;
  searchPath: string;
  lists: string | null;
};

type FullResult = FullQueryResults<false>;
type TransactionQuery = NeonQueryPromise<false, true, FullResult>;

export function makeDb(url: string): {
  sql: Sql;
  transact: Transact;
  describe: () => Promise<DbInfo>;
} {
  const query = neon(url, { fullResults: true });
  // neon の fullResults は pg の QueryResult とほぼ同形(oid のみ持たない)。
  // API 側は rows / rowCount / command を使うため、Sql の戻り値に合わせる。
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) =>
    query(strings, ...values)) as unknown as Sql;
  const transact: Transact = async (statements) => {
    await query.transaction(statements as unknown as TransactionQuery[]);
  };
  const describe = async (): Promise<DbInfo> => {
    const result = await sql`
      SELECT current_database() AS database,
             current_user AS user,
             current_schema() AS schema,
             current_setting('search_path') AS search_path,
             to_regclass('public.lists') AS lists
    `;
    const [row] = result.rows as Array<{
      database: string;
      user: string;
      schema: string;
      search_path: string;
      lists: string | null;
    }>;
    return {
      urlFingerprint: createHash("sha256").update(url).digest("hex"),
      database: row.database,
      user: row.user,
      schema: row.schema,
      searchPath: row.search_path,
      lists: row.lists,
    };
  };
  return { sql, transact, describe };
}
