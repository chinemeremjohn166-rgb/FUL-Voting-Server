import { badRequest, notFound } from "./http.ts";
import { Temporal } from "./temporal.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

/** Validates a route param as a UUID. Malformed IDs can't exist, so they are reported as 404. */
export const uuidParam = (value: unknown, label = "Resource"): string => {
  if (!isUuid(value)) throw notFound(`${label} not found`);
  return value.toLowerCase();
};

/** Validates a body field as a UUID (400 on failure). */
export const uuidField = (value: unknown, field: string): string => {
  if (!isUuid(value)) throw badRequest(`${field} must be a valid UUID`);
  return value.toLowerCase();
};

interface StringOpts {
  required?: boolean;
  max?: number;
  min?: number;
}

/** Returns a trimmed string, `undefined` when absent and optional. Rejects non-strings. */
export function str(value: unknown, field: string, opts: StringOpts & { required: true }): string;
export function str(value: unknown, field: string, opts?: StringOpts): string | undefined;
export function str(value: unknown, field: string, opts: StringOpts = {}): string | undefined {
  const { required = false, max = 255, min = 1 } = opts;
  if (value === undefined || value === null || (typeof value === "string" && value.trim() === "")) {
    if (required) throw badRequest(`${field} is required`);
    return undefined;
  }
  if (typeof value !== "string") throw badRequest(`${field} must be a string`);
  const trimmed = value.trim();
  if (trimmed.length < min) throw badRequest(`${field} must be at least ${min} characters`);
  if (trimmed.length > max) throw badRequest(`${field} must be at most ${max} characters`);
  return trimmed;
}

/** Integer within [min, max]. Rejects floats, NaN and numeric strings like "abc". */
export const int = (value: unknown, field: string, min: number, max: number): number => {
  const n = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isInteger(n) || n < min || n > max) {
    throw badRequest(`${field} must be an integer between ${min} and ${max}`);
  }
  return n;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const email = (value: unknown): string => {
  const v = str(value, "Email address", { required: true, max: 254 }).toLowerCase();
  if (!EMAIL_RE.test(v)) throw badRequest("Invalid email (e.g: user@sample.com)");
  return v;
};

const PASSWORD_RULES =
  "Password must be 8-72 characters and include an uppercase letter, a lowercase letter, a digit and a special character (e.g. @$!%*?&#_-.)";
const PASSWORD_RE = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z\d\s])\S{8,72}$/;

/** Passwords are NOT trimmed. 72 is bcrypt's input limit. */
export const password = (value: unknown): string => {
  if (typeof value !== "string" || value.length === 0) throw badRequest("Password is required");
  if (!PASSWORD_RE.test(value)) throw badRequest(PASSWORD_RULES);
  return value;
};

/** Matric numbers are normalised to upper-case so lookups are case-insensitive. */
export const matricNo = (value: unknown, required = false): string | undefined => {
  const v = str(value, "Matric No", { required, max: 32 });
  return v?.toUpperCase();
};

/** Only http(s) URLs: blocks javascript:/data: URLs that would be stored XSS in a frontend. */
export const httpUrl = (value: unknown, field: string): string | null => {
  const v = str(value, field, { max: 2048 });
  if (v === undefined) return null;
  let parsed: URL;
  try {
    parsed = new URL(v);
  } catch {
    throw badRequest(`${field} must be a valid URL`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw badRequest(`${field} must use http or https`);
  }
  return parsed.toString();
};

/** Parses an ISO-8601 timestamp (with offset or Z) into a Temporal.Instant. */
export const instant = (value: unknown, field: string): Temporal.Instant => {
  if (typeof value !== "string") throw badRequest(`${field} must be an ISO-8601 date-time string`);
  try {
    return Temporal.Instant.from(value);
  } catch {
    throw badRequest(`${field} must be an ISO-8601 date-time with a timezone, e.g. 2026-11-01T09:00:00Z`);
  }
};

/** Ensures the body is a plain object (express.json leaves it undefined for non-JSON requests). */
export const body = (value: unknown): Record<string, unknown> => {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) throw badRequest("Request body must be a JSON object");
  return value as Record<string, unknown>;
};

/** Array field with a size cap. */
export const array = (value: unknown, field: string, max: number): unknown[] => {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) throw badRequest(`${field} must be an array`);
  if (value.length > max) throw badRequest(`${field} may contain at most ${max} items`);
  return value;
};
