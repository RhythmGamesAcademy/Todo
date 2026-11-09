import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { clientIp, rateLimit } from "../../api/src/rate-limit.js";

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("rateLimit", () => {
  it("窓内の上限を超えると429になり、窓が過ぎると再び通る", async () => {
    const app = new Hono();
    let handled = 0;
    app.use(
      "/r",
      rateLimit({
        scope: "test",
        max: 3,
        windowMs: 60,
        key: () => "same",
      }),
    );
    app.post("/r", (c) => c.text(`ok${(handled += 1)}`));

    for (let i = 0; i < 3; i += 1) {
      const response = await app.request("/r", { method: "POST" });
      expect(response.status).toBe(200);
    }
    const limited = await app.request("/r", { method: "POST" });
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("Retry-After"))).toBeGreaterThan(0);
    await expect(limited.json()).resolves.toMatchObject({
      error: "too many requests",
    });
    // 同一窓ではキーごとに計数を進める。
    expect(handled).toBe(3);
    await wait(80);
    expect((await app.request("/r", { method: "POST" })).status).toBe(200);
  });

  it("キーが違えば別の窓で計数する", async () => {
    const app = new Hono();
    app.use(
      "/r",
      rateLimit({
        scope: "test",
        max: 1,
        windowMs: 60_000,
        key: (c) => c.req.query("k") ?? "",
      }),
    );
    app.post("/r", (c) => c.text("ok"));
    expect((await app.request("/r?k=a", { method: "POST" })).status).toBe(200);
    expect((await app.request("/r?k=a", { method: "POST" })).status).toBe(429);
    expect((await app.request("/r?k=b", { method: "POST" })).status).toBe(200);
  });

  it("clientIp は x-forwarded-for の先頭を使う", () => {
    const app = new Hono();
    let ip = "";
    app.use("/", (c, next) => {
      ip = clientIp(c);
      return next();
    });
    app.get("/", (c) => c.text("ok"));
    app.request("/", {
      headers: { "x-forwarded-for": "203.0.113.7, 70.41.3.25" },
    });
    expect(ip).toBe("203.0.113.7");
  });
});
