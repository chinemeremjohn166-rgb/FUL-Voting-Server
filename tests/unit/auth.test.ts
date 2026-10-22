import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { signToken, verifyToken, isTokenRevoked } from "../../src/lib/auth.ts";
import jwt from "jsonwebtoken";

describe("Auth Library & JWT Security", () => {
  const userId = "123e4567-e89b-12d3-a456-426614174000";

  it("should sign and verify valid JWT token", () => {
    const token = signToken(userId);
    const decoded = verifyToken(token);

    assert.equal(decoded.sub, userId);
    assert.equal(typeof decoded.iat, "number");
  });

  it("should refuse tokens issued at or before the sign-out cutoff (H6 fix)", () => {
    const logout = new Date();
    const cutoff = logout.getTime();

    // Tokens issued before logout are revoked.
    assert.equal(isTokenRevoked(new Date(cutoff - 5000), Math.floor((cutoff - 10000) / 1000)), true);

    // A token minted in the same second as the sign-out is refused, not trusted.
    assert.equal(isTokenRevoked(logout, Math.floor(cutoff / 1000)), true);

    // Tokens issued after logout are accepted.
    assert.equal(isTokenRevoked(logout, Math.floor(cutoff / 1000) + 60), false);

    // A user who has never logged out has no cutoff.
    assert.equal(isTokenRevoked(null, Math.floor(cutoff / 1000)), false);
    assert.equal(isTokenRevoked(undefined, Math.floor(cutoff / 1000)), false);
  });

  it("should reject token signed with a different secret (C3 fix)", () => {
    const forgedToken = jwt.sign({ sub: userId }, "attacker_secret_key");
    assert.throws(() => verifyToken(forgedToken));
  });

  it("should reject token with 'none' algorithm exploit", () => {
    const unsignedToken = jwt.sign({ sub: userId }, "", { algorithm: "none" as any });
    assert.throws(() => verifyToken(unsignedToken));
  });

  it("should reject malformed token string", () => {
    assert.throws(() => verifyToken("invalid.token.payload"));
  });
});
