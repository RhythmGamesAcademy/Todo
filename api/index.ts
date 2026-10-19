import { handle } from "hono/vercel";
import { createApp } from "./src/app";
import { makeDb } from "./src/sql";

const app = createApp(makeDb(process.env.DATABASE_URL!));

export const GET = handle(app);
export const POST = handle(app);
export const PATCH = handle(app);
export const DELETE = handle(app);
