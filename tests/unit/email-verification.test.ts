import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { generateVerificationCode, sendVerificationEmail } from "../../src/lib/email.ts";

describe("Email Verification and Resend Configuration", () => {
  it("should generate a 6-digit numeric code", () => {
    for (let i = 0; i < 20; i++) {
      const code = generateVerificationCode();
      assert.equal(typeof code, "string");
      assert.equal(code.length, 6);
      assert.equal(/^\d{6}$/.test(code), true);
    }
  });

  it("should gracefully handle sending verification email in test mode", async () => {
    const res = await sendVerificationEmail("test@example.com", "123456", "Test User");
    assert.equal(res.success, true);
  });
});
