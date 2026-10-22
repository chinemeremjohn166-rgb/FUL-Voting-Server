import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isUuid,
  uuidParam,
  uuidField,
  str,
  int,
  email,
  password,
  matricNo,
  httpUrl,
  body,
  array,
} from "../../src/lib/validation.ts";
import { HttpError } from "../../src/lib/http.ts";

describe("Validation Library", () => {
  describe("UUID Validation", () => {
    it("should accept valid v4 UUID", () => {
      const valid = "123e4567-e89b-12d3-a456-426614174000";
      assert.equal(isUuid(valid), true);
      assert.equal(uuidParam(valid, "Test"), valid.toLowerCase());
      assert.equal(uuidField(valid, "field"), valid.toLowerCase());
    });

    it("should reject malformed UUID with 404 in uuidParam (H3 fix)", () => {
      assert.throws(() => uuidParam("not-a-uuid", "Election"), (err: any) => {
        assert.equal(err instanceof HttpError, true);
        assert.equal(err.status, 404);
        assert.equal(err.message, "Election not found");
        return true;
      });
    });

    it("should reject non-string UUIDs without crashing (H2 fix)", () => {
      assert.throws(() => uuidParam(12345, "User"), HttpError);
      assert.throws(() => uuidParam(null, "User"), HttpError);
      assert.throws(() => uuidParam(undefined, "User"), HttpError);
    });
  });

  describe("String & Int Validation", () => {
    it("should safely trim strings and reject non-strings", () => {
      assert.equal(str("  hello  ", "greeting", { required: true }), "hello");
      assert.throws(() => str(123, "field", { required: true }), HttpError);
      assert.throws(() => str(" ", "field", { required: true }), HttpError);
      assert.equal(str(undefined, "field"), undefined);
    });

    it("should enforce integer bounds and reject floats and NaN (M4 fix)", () => {
      assert.equal(int(1, "seats", 1, 10), 1);
      assert.equal(int("5", "seats", 1, 10), 5);
      assert.throws(() => int(1.5, "seats", 1, 10), HttpError);
      assert.throws(() => int("abc", "seats", 1, 10), HttpError);
      assert.throws(() => int(0, "seats", 1, 10), HttpError);
      assert.throws(() => int(11, "seats", 1, 10), HttpError);
    });
  });

  describe("Email & Password Validation", () => {
    it("should validate and normalize email addresses", () => {
      assert.equal(email("  USER@SAMPLE.COM "), "user@sample.com");
      assert.throws(() => email("invalid-email"), HttpError);
      assert.throws(() => email(""), HttpError);
    });

    it("should enforce strong password rules and length limits", () => {
      assert.equal(password("StrongPass1!"), "StrongPass1!");
      assert.throws(() => password("weak"), HttpError);
      assert.throws(() => password("alllowercase123!"), HttpError);
      assert.throws(() => password("ALLUPPERCASE123!"), HttpError);
      assert.throws(() => password("NoSpecialChar123"), HttpError);
    });
  });

  describe("Matriculation Number Validation (H1 & M8 fix)", () => {
    it("should be optional by default and normalize to uppercase", () => {
      assert.equal(matricNo(undefined), undefined);
      assert.equal(matricNo(null), undefined);
      assert.equal(matricNo("  sci/2026/001  "), "SCI/2026/001");
    });

    it("should enforce requirement when required flag is true", () => {
      assert.throws(() => matricNo("", true), HttpError);
    });
  });

  describe("URL Validation (M7 fix)", () => {
    it("should allow valid http/https URLs", () => {
      assert.equal(httpUrl("https://example.com/photo.jpg", "Photo"), "https://example.com/photo.jpg");
    });

    it("should reject javascript: and data: URLs (XSS vectors)", () => {
      assert.throws(() => httpUrl("javascript:alert(1)", "Photo"), HttpError);
      assert.throws(() => httpUrl("data:text/html,<script>", "Photo"), HttpError);
    });
  });

  describe("Body & Array Parsers (H2 fix)", () => {
    it("should reject non-object body", () => {
      assert.throws(() => body("string-body"), HttpError);
      assert.throws(() => body([1, 2, 3]), HttpError);
      assert.deepEqual(body({ key: "val" }), { key: "val" });
    });

    it("should enforce array type and maximum length", () => {
      assert.deepEqual(array([1, 2], "items", 5), [1, 2]);
      assert.throws(() => array("not-array", "items", 5), HttpError);
      assert.throws(() => array([1, 2, 3], "items", 2), HttpError);
    });
  });
});
