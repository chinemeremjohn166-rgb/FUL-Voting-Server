import type { Request, Response, NextFunction } from "express";
import { verifyToken, isTokenRevoked, type AuthUser } from "../lib/auth.ts";
import { isUuid } from "../lib/validation.ts";
import { db } from "../prisma/db.ts";

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

const readCookie = (header: string | undefined, name: string): string | undefined => {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    if (part.slice(0, idx).trim() === name) {
      try {
        return decodeURIComponent(part.slice(idx + 1).trim());
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
};

/**
 * Authenticates using a Bearer token or the `token` cookie.
 * The token only identifies the user; role and validity are loaded live from the
 * database on every request so demotions, deletions and logouts take effect immediately (Fix H6).
 */
export const authenticate = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : readCookie(req.headers.cookie, "token");

  if (!token) {
    res.status(401).json({ message: "Authentication required. Please log in." });
    return;
  }

  let payload;
  try {
    payload = verifyToken(token);
  } catch {
    res.status(401).json({ message: "Invalid or expired authentication token." });
    return;
  }

  if (!isUuid(payload.sub)) {
    res.status(401).json({ message: "Invalid or expired authentication token." });
    return;
  }

  try {
    const user = await db.orm.public.User.where({ id: payload.sub }).first();
    if (!user) {
      res.status(401).json({ message: "User account no longer exists." });
      return;
    }

    // Revocation lives on the user row, so it is checked against the row this
    // request already loaded instead of a per-process map.
    if (isTokenRevoked(user.tokensRevokedAt, payload.iat)) {
      res.status(401).json({ message: "Token has been revoked. Please log in again." });
      return;
    }

    // Role is loaded from the database row, not blindly trusted from the token
    req.user = { userId: user.id, email: user.email, role: user.role };
    next();
  } catch (err) {
    next(err);
  }
};

/**
 * Middleware to enforce ADMIN role. Must be placed after authenticate.
 */
export const requireAdmin = (req: Request, res: Response, next: NextFunction): void => {
  if (!req.user) {
    res.status(401).json({ message: "Authentication required." });
    return;
  }

  if (req.user.role !== "ADMIN") {
    res.status(403).json({ message: "Forbidden: Admin privileges required." });
    return;
  }

  next();
};
