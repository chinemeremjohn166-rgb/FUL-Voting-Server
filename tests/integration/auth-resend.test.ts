import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import app from "../../src/app.ts";
import { db } from "../../src/prisma/db.ts";

describe("Registration Email Verification and Admin Auth Flow", () => {
  let server: Server;
  let baseUrl: string;

  before((_t, done) => {
    server = app.listen(0, () => {
      const addr = server.address() as any;
      baseUrl = `http://127.0.0.1:${addr.port}`;
      done();
    });
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    try {
      await db.orm.public.User.where({ email: testEmail }).delete();
    } catch {
      // ignore
    }
  });

  const testEmail = `voter-${Date.now()}@test-e2e.org`;
  const testPassword = "Password123!";
  const testFullName = "Test Voter";

  it("should register a user and require email verification", async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fullname: testFullName,
        email: testEmail,
        password: testPassword,
      }),
    });

    assert.equal(res.status, 201);
    const body = await res.json();
    assert.equal(body.requiresVerification, true);
    assert.equal(body.email, testEmail);
    assert.equal(typeof body.message, "string");
  });

  it("should refuse login for unverified voter and indicate requiresVerification", async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        identifier: testEmail,
        password: testPassword,
      }),
    });

    assert.equal(res.status, 403);
    const body = await res.json();
    assert.equal(body.requiresVerification, true);
    assert.equal(body.email, testEmail);
  });

  it("should reject incorrect verification code", async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/verify-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: testEmail,
        code: "000000",
      }),
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.message.includes("Invalid verification code"), true);
  });

  it("should verify email with correct code and issue token", async () => {
    // Read the verification code saved in the DB
    const user = await db.orm.public.User.where({ email: testEmail }).first();
    assert.notEqual(user, null);
    assert.notEqual(user!.verificationCode, null);

    const res = await fetch(`${baseUrl}/api/v1/auth/verify-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: testEmail,
        code: user!.verificationCode,
      }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(typeof body.token, "string");
    assert.equal(body.user.email, testEmail);
    assert.equal(body.user.isVerified, true);
    assert.equal(body.user.role, "VOTER");
  });

  it("should reject calling verify-email on an already verified user (C-01 fix)", async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/verify-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: testEmail,
        code: "123456",
      }),
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.token, undefined);
    assert.equal(body.message.includes("already verified"), true);
  });

  it("should allow login after verification", async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        identifier: testEmail,
        password: testPassword,
      }),
    });

    assert.equal(res.status, 200);
    const body = await res.json();
    assert.equal(typeof body.token, "string");
    assert.equal(body.user.email, testEmail);
    assert.equal(body.user.isVerified, true);
  });

  it("should authenticate admin account and allow admin-only actions", async () => {
    // Login as admin
    const adminLoginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        identifier: "admin@voting.test",
        password: "Admin#2026",
      }),
    });

    assert.equal(adminLoginRes.status, 200);
    const adminData = await adminLoginRes.json();
    assert.equal(adminData.user.role, "ADMIN");
    const adminToken = adminData.token;

    // Verify current user endpoint returns role ADMIN
    const meRes = await fetch(`${baseUrl}/api/v1/auth/me`, {
      headers: { Authorization: `Bearer ${adminToken}` },
    });
    assert.equal(meRes.status, 200);
    const meData = await meRes.json();
    assert.equal(meData.user.role, "ADMIN");

    // Admin creating a draft election succeeds
    const tomorrow = new Date(Date.now() + 86400000).toISOString();
    const fourDaysLater = new Date(Date.now() + 4 * 86400000).toISOString();

    const createRes = await fetch(`${baseUrl}/api/v1/elections`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        title: "Test General Election",
        description: "Created by automated integration test",
        startsAt: tomorrow,
        endsAt: fourDaysLater,
      }),
    });

    assert.equal(createRes.status, 201);
    const createData = await createRes.json();
    assert.equal(createData.election.title, "Test General Election");

    // Clean up created election
    await db.orm.public.Election.where({ id: createData.election.id }).delete();
  });

  it("should prevent regular voter from performing admin actions", async () => {
    // Login as the verified regular voter
    const loginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        identifier: testEmail,
        password: testPassword,
      }),
    });
    const { token: voterToken } = await loginRes.json();

    // Attempt to create election as voter
    const createRes = await fetch(`${baseUrl}/api/v1/elections`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${voterToken}`,
      },
      body: JSON.stringify({
        title: "Unauthorized Election",
        startsAt: new Date(Date.now() + 86400000).toISOString(),
        endsAt: new Date(Date.now() + 4 * 86400000).toISOString(),
      }),
    });

    assert.equal(createRes.status, 403);
    const body = await createRes.json();
    assert.equal(body.message.includes("Admin privileges required"), true);
  });
});
