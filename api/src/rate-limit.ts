import type { Context, Next } from "hono";

/**
 * 最小構成の固定窓レートリミッタ(監査 2026-11-06 M-003)。
 *
 * サーバーレス(Vercel Functions)ではインスタンスごとにメモリが分かれるため、
 * ここでの計数はベストエフォート。インスタンスをまたいだ正確な制限は
 * Vercel Firewall のレートルール(ダッシュボード設定)で行う前提で、
 * この層は短期集中の一次防御として主要な書き込み・アップロード経路を締める。
 */

export interface RateLimitOptions {
  /** 計数の名前空間。経路ごとに分ける。 */
  scope: string;
  /** 制限対象の識別子(トークンやIP)。 */
  key: (c: Context) => string;
  windowMs: number;
  /** 窓あたりの上限。超過したリクエストは 429。 */
  max: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

// 無限成長を防ぐため、保持するキー数を絞る。
const MAX_KEYS = 10_000;

export function rateLimit(options: RateLimitOptions) {
  const buckets = new Map<string, Bucket>();
  return async (c: Context, next: Next): Promise<Response | void> => {
    const now = Date.now();
    if (buckets.size > MAX_KEYS)
      for (const [id, bucket] of buckets)
        if (bucket.resetAt <= now) buckets.delete(id);
    const id = `${options.scope}:${options.key(c)}`;
    const bucket = buckets.get(id);
    if (!bucket || bucket.resetAt <= now) {
      buckets.set(id, { count: 1, resetAt: now + options.windowMs });
      await next();
      return;
    }
    bucket.count += 1;
    if (bucket.count > options.max) {
      const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      c.header("Retry-After", String(retryAfter));
      return c.json({ error: "too many requests" }, 429);
    }
    await next();
  };
}

/** Vercel Functions では x-forwarded-for に実クライアントIPが入る。 */
export const clientIp = (c: Context): string =>
  c.req.header("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
