import { randomBytes } from "node:crypto";

export class ApiException extends Error {
  constructor(
    readonly status: 400 | 404 | 500,
    message: string,
  ) {
    super(message);
    this.name = "ApiException";
  }
}

export function generateToken(): string {
  return randomBytes(32).toString("base64url");
}

export function assertText(value: unknown, max: number, field: string): string {
  if (typeof value !== "string")
    throw new ApiException(400, `${field} must be a string`);
  const text = value.trim();
  if (!text) throw new ApiException(400, `${field} is required`);
  if (text.length > max)
    throw new ApiException(400, `${field} must be at most ${max} characters`);
  return text;
}
