import jwt from "jsonwebtoken";
import { config } from "../config.ts";
import { toEpochMs } from "./temporal.ts";

export interface TokenPayload {
  sub: string;
  iat: number;
  exp: number;
}

export interface AuthUser {
  userId: string;
  email: string;
  role: "VOTER" | "ADMIN";
}

/**
 * A token is revoked when it was issued at or before the user's last sign-out.
 * The cutoff comes from the user row, so it survives a restart and is shared by
 * every process. `iat` has second granularity, so the comparison is inclusive:
 * a token minted in the same second as the sign-out is refused, not trusted.
 */
export const isTokenRevoked = (revokedAt: unknown, iat: number): boolean => {
  const revokedMs = toEpochMs(revokedAt);
  return revokedMs !== undefined && iat * 1000 <= revokedMs;
};

export const signToken = (userId: string): string => {
  return jwt.sign({ sub: userId }, config.jwtSecret, {
    expiresIn: config.jwtExpiresIn as jwt.SignOptions["expiresIn"],
    algorithm: "HS256",
  });
};

export const verifyToken = (token: string): TokenPayload => {
  const decoded = jwt.verify(token, config.jwtSecret, { algorithms: ["HS256"] });
  if (typeof decoded !== "object" || typeof decoded.sub !== "string") {
    throw new Error("Malformed token payload");
  }
  return decoded as TokenPayload;
};
