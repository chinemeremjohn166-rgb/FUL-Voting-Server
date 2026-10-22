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

export const config = {
  nodeEnv: NODE_ENV,
  isProduction: NODE_ENV === "production",
  isTest: NODE_ENV === "test",
  port: Number(process.env.PORT) || 8000,
  databaseUrl: required("DATABASE_URL"),
  jwtSecret: JWT_SECRET,
  jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? "1d",
} as const;
