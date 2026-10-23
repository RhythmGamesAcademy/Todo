import { handle } from "hono/vercel";
import { createApp } from "./src/app.js";
import { makeDb } from "./src/sql.js";

const app = createApp(makeDb(process.env.DATABASE_URL!));

export const GET = handle(app);
export const POST = handle(app);
export const PATCH = handle(app);
export const DELETE = handle(app);
