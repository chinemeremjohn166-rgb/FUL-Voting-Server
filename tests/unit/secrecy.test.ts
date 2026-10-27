import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Ballot Secrecy & Data Contract Integrity (C2 Fix)", () => {
  const schemaPath = path.resolve(__dirname, "../../src/prisma/contract.prisma");
  const schemaContent = fs.readFileSync(schemaPath, "utf-8");

  it("Vote model must NOT have a userId or relation to User", () => {
    const voteModelMatch = schemaContent.match(/model Vote \{[\s\S]*?\}/);
    assert.notEqual(voteModelMatch, null);
    const voteModel = voteModelMatch![0];

    assert.equal(/userId/i.test(voteModel), false);
    assert.equal(/User\s+/.test(voteModel), false);
  });

  it("Vote model must NOT have a ballotId or relation to Ballot", () => {
    const voteModelMatch = schemaContent.match(/model Vote \{[\s\S]*?\}/);
    const voteModel = voteModelMatch![0];

    assert.equal(/ballotId/i.test(voteModel), false);
    assert.equal(/Ballot\s+/.test(voteModel), false);
  });

  it("Vote model must NOT carry a timestamp of its own", () => {
    const voteModelMatch = schemaContent.match(/model Vote \{[\s\S]*?\}/);
    assert.notEqual(voteModelMatch, null);
    const voteModel = voteModelMatch![0];

    // castAt was dropped because a timestamp on the choice row lets votes be
    // joined to ballots by time, which breaks the voter/ballot link.
    assert.equal(/castAt/i.test(voteModel), false);
    assert.equal(/DateTime/i.test(voteModel), false);
  });
});
