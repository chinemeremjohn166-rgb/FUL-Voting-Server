import "dotenv/config";

/**
 * Centralised, validated environment configuration.
 * Imported first by every module that needs env vars, so .env is always
 * loaded before any value is read (fixes the ESM import-order trap).
 * Fails fast at boot instead of falling back to insecure defaults.
 */
const required = (name: string): string => {
  const value = process.env[name];
  if (!value || !value.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
};

const NODE_ENV = process.env.NODE_ENV ?? process.env.ENV ?? "development";
const JWT_SECRET = required("JWT_SECRET");

if (NODE_ENV === "production" && JWT_SECRET.length < 32) {
  throw new Error("JWT_SECRET must be at least 32 characters in production");
}

/**
 * Browser origins allowed to call this API directly. `CORS_ORIGIN` is a
 * comma-separated list; the default covers each address Vite serves the client
 * on (it binds IPv6, so `[::1]` is the one a browser actually uses).
 */
const corsOrigins = (
  process.env.CORS_ORIGIN ??
  "http://localhost:5173,http://127.0.0.1:5173,http://[::1]:5173,https://ful-voting.vercel.app"
)
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

export const config = {
  get nodeEnv() {
    return process.env.NODE_ENV ?? process.env.ENV ?? "development";
  },
  get isProduction() {
    return this.nodeEnv === "production";
  },
  get isTest() {
    return this.nodeEnv === "test";
  },
  port: Number(process.env.PORT) || 8000,
  databaseUrl: required("DATABASE_URL"),
  jwtSecret: JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "1d",
  resendApiKey: process.env.RESEND_API_KEY?.trim() ?? "",
  resendFromEmail: process.env.RESEND_FROM_EMAIL?.trim() || "BallotBox <onboarding@resend.dev>",
  get emailVerification(): boolean {
    const raw = process.env.EMAIL_VERIFICATION ?? process.env.REQUIRE_EMAIL_VERIFICATION ?? "true";
    return raw.trim().toLowerCase() !== "false";
  },
  corsOrigins,
} as const;
