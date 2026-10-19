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

type FullResult = FullQueryResults<false>;
type TransactionQuery = NeonQueryPromise<false, true, FullResult>;

export function makeDb(url: string): { sql: Sql; transact: Transact } {
  const query = neon(url, { fullResults: true });
  // neon の fullResults は pg の QueryResult とほぼ同形(oid のみ持たない)。
  // API 側は rows / rowCount / command を使うため、Sql の戻り値に合わせる。
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) =>
    query(strings, ...values)) as unknown as Sql;
  const transact: Transact = async (statements) => {
    await query.transaction(statements as unknown as TransactionQuery[]);
  };
  return { sql, transact };
}
