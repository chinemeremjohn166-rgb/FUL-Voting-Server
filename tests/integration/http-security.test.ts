import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import app from "../../src/app.ts";

describe("HTTP Security & Error Handling Middleware (H4, H5, M10 Fixes)", () => {
  let server: Server;
  let baseUrl: string;

  before((_t, done) => {
    // Start app on an ephemeral port (port 0)
    server = app.listen(0, () => {
      const addr = server.address() as any;
      baseUrl = `http://127.0.0.1:${addr.port}`;
      done();
    });
  });

  after((_t, done) => {
    server.close(() => done());
  });

  it("should include security headers via Helmet (Fix M10)", async () => {
    const res = await fetch(`${baseUrl}/health`);
    assert.equal(res.status === 200 || res.status === 503, true);

    const headers = res.headers;
    assert.equal(headers.get("x-content-type-options"), "nosniff");
    assert.equal(headers.has("content-security-policy"), true);
  });

  it("should handle malformed JSON body with 400 Bad Request", async () => {
    const res = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: '{"email": "broken-json',
    });

    assert.equal(res.status, 400);
    const body = await res.json();
    assert.equal(body.message, "Malformed JSON in request body.");
  });

  it("should reject payload exceeding 50kb with 413 (Fix M10)", async () => {
    const largeString = "A".repeat(60 * 1024);
    const res = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ data: largeString }),
    });

    assert.equal(res.status, 413);
    const body = await res.json();
    assert.equal(body.message, "Request body too large.");
  });

  it("should return clean 404 for nonexistent routes", async () => {
    const res = await fetch(`${baseUrl}/api/v1/nonexistent-endpoint`);
    assert.equal(res.status, 404);
    const body = await res.json();
    assert.equal(body.message.includes("Route not found"), true);
  });

  it("should return 401 when accessing protected route without token", async () => {
    const res = await fetch(`${baseUrl}/api/v1/elections`);
    assert.equal(res.status, 401);
    const body = await res.json();
    assert.equal(body.message, "Authentication required. Please log in.");
  });
});
