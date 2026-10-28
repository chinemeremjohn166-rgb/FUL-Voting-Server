import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import app from "../../src/app.ts";
import { db } from "../../src/prisma/db.ts";

describe("Email Verification Toggle (EMAIL_VERIFICATION env var)", () => {
  let server: Server;
  let baseUrl: string;
  const originalEnv = process.env.EMAIL_VERIFICATION;

  before((_t, done) => {
    server = app.listen(0, () => {
      const addr = server.address() as any;
      baseUrl = `http://127.0.0.1:${addr.port}`;
      done();
    });
  });

  after(async () => {
    process.env.EMAIL_VERIFICATION = originalEnv;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    try {
      await db.orm.public.User.where({ email: noVerifyEmail }).delete();
      await db.orm.public.User.where({ email: verifyEmailAddr }).delete();
    } catch {
      // ignore
    }
  });

  const noVerifyEmail = `noverify-${Date.now()}@test.org`;
  const verifyEmailAddr = `verify-${Date.now()}@test.org`;
  const testPassword = "Password123!";

  it("when EMAIL_VERIFICATION=false: registers user immediately without requiring verification code", async () => {
    process.env.EMAIL_VERIFICATION = "false";

    const res = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fullname: "Direct User",
        email: noVerifyEmail,
        password: testPassword,
        matricNo: `NV/${Date.now().toString().slice(-6)}`,
      }),
    });

    assert.equal(res.status, 201);
    const data = await res.json();
    assert.equal(data.requiresVerification, false);
    assert.equal(typeof data.token, "string", "Must issue token directly");
    assert.equal(data.user.email, noVerifyEmail);
    assert.equal(data.user.isVerified, true);

    // Verify token works on protected route immediately
    const meRes = await fetch(`${baseUrl}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${data.token}` },
    });
    assert.equal(meRes.status, 200);
    const meData = await meRes.json();
    assert.equal(meData.user.email, noVerifyEmail);
  });

  it("when EMAIL_VERIFICATION=false: allows logging in directly without verification block", async () => {
    process.env.EMAIL_VERIFICATION = "false";

    const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        identifier: noVerifyEmail,
        password: testPassword,
      }),
    });

    assert.equal(res.status, 200);
    const data = await res.json();
    assert.equal(typeof data.token, "string");
    assert.equal(data.user.isVerified, true);
  });

  it("when EMAIL_VERIFICATION=true: enforces verification flow", async () => {
    process.env.EMAIL_VERIFICATION = "true";

    const regRes = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fullname: "Verify User",
        email: verifyEmailAddr,
        password: testPassword,
      }),
    });

    assert.equal(regRes.status, 201);
    const regData = await regRes.json();
    assert.equal(regData.requiresVerification, true);
    assert.equal(regData.token, undefined);

    // Login without verification is blocked with 403
    const loginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        identifier: verifyEmailAddr,
        password: testPassword,
      }),
    });

    assert.equal(loginRes.status, 403);
    const loginData = await loginRes.json();
    assert.equal(loginData.requiresVerification, true);

    // Verify email with code from DB
    const user = await db.orm.public.User.where({ email: verifyEmailAddr }).first();
    assert.notEqual(user, null);

    const verifyRes = await fetch(`${baseUrl}/api/v1/auth/verify-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: verifyEmailAddr,
        code: user!.verificationCode,
      }),
    });

    assert.equal(verifyRes.status, 200);
    const verifyData = await verifyRes.json();
    assert.equal(typeof verifyData.token, "string");
    assert.equal(verifyData.user.isVerified, true);

    // Now login succeeds
    const afterLogin = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        identifier: verifyEmailAddr,
        password: testPassword,
      }),
    });
    assert.equal(afterLogin.status, 200);
  });
});
