import { beforeAll, describe, expect, it } from "vitest";
import { parseCloudState } from "../../src/cloud/parse";
import { createApp } from "./app";
import { makeDb } from "./sql";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeDb = databaseUrl ? describe : describe.skip;

describeDb("共有リストAPI", () => {
  const db = makeDb(databaseUrl ?? "");
  const app = createApp(db);
  let token = "";
  let creatorId = "";

  beforeAll(async () => {
    await db.sql`DELETE FROM lists`;
    const res = await app.request("/api/lists", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "チームTODO", name: "あき" }),
    });
    expect(res.status).toBe(201);
    token = ((await res.json()) as { token: string }).token;
  });

  it("作成したリストのトークンは43文字のbase64url", () => {
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("全量取得は CloudState の検証を通り、revision は作成時の2のまま変わらない", async () => {
    const first = await app.request(`/api/lists/${token}`);
    expect(first.status).toBe(200);
    const state = await first.json();
    expect(() => parseCloudState(state)).not.toThrow();
    expect(state).toMatchObject({
      list: { title: "チームTODO", revision: 2 },
      todos: [],
    });
    expect(state.users).toHaveLength(1);
    expect(state.users[0]).toMatchObject({ name: "あき" });
    expect(state.users[0].id).toMatch(UUID);
    creatorId = state.users[0].id;
    expect(state.activities).toHaveLength(1);
    expect(state.activities[0]).toMatchObject({
      kind: "user.joined",
      after: "あき",
      userId: creatorId,
    });

    const second = await app.request(`/api/lists/${token}`);
    expect((await second.json()).list.revision).toBe(2);

    const revision = await app.request(`/api/lists/${token}/revision`);
    expect(revision.status).toBe(200);
    expect(await revision.json()).toEqual({ revision: 2 });
  });

  it("存在しないトークンは全ルートで404", async () => {
    expect((await app.request("/api/lists/unknown")).status).toBe(404);
    expect((await app.request("/api/lists/unknown/revision")).status).toBe(404);
    const join = await app.request("/api/lists/unknown/join", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "だれか" }),
    });
    expect(join.status).toBe(404);
  });

  it("新規名の参加は新しい userId、既存名は同じ userId を返す", async () => {
    const join = (name: string) =>
      app.request(`/api/lists/${token}/join`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });

    const first = await join("はる");
    expect(first.status).toBe(200);
    const firstBody = (await first.json()) as {
      userId: string;
      name: string;
    };
    expect(firstBody.name).toBe("はる");
    expect(firstBody.userId).toMatch(UUID);

    const joinedState = await (await app.request(`/api/lists/${token}`)).json();
    const joined = joinedState.activities.filter(
      (activity: { kind: string; after: string | null }) =>
        activity.kind === "user.joined" && activity.after === "はる",
    );
    expect(joined).toHaveLength(1);
    expect(joined[0].userId).toBe(firstBody.userId);

    const again = await join("はる");
    expect(((await again.json()) as { userId: string }).userId).toBe(
      firstBody.userId,
    );

    const creator = await join("あき");
    expect(((await creator.json()) as { userId: string }).userId).toBe(
      creatorId,
    );

    const finalState = await (await app.request(`/api/lists/${token}`)).json();
    expect(() => parseCloudState(finalState)).not.toThrow();
    const joinActivities = finalState.activities.filter(
      (activity: { kind: string }) => activity.kind === "user.joined",
    );
    expect(joinActivities).toHaveLength(2);
  });

  it("不正な作成リクエストは400を返す", async () => {
    const res = await app.request("/api/lists", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "  ", name: "あき" }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
  });
});
