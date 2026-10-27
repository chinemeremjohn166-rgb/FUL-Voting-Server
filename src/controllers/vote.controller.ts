import type { Request, Response } from "express";
import crypto from "crypto";
import { db } from "../prisma/db.ts";
import { uuidParam, uuidField, body, array } from "../lib/validation.ts";
import { asyncHandler, badRequest, conflict, forbidden, notFound, isUniqueViolation } from "../lib/http.ts";
import { now } from "../lib/temporal.ts";

interface VoteChoice {
  positionId: string;
  candidateId: string | null;
}

/** Marks the abstention slot in a position's set of choices. */
const ABSTENTION = "__abstention__";

/**
 * Casts a secret ballot inside an ACID transaction.
 *
 * Enforces:
 * 1. Election status must be OPEN.
 * 2. Current time must fall between startsAt and endsAt.
 * 3. Voter must exist in VoterRoll.
 * 4. Voter must NOT have already cast a Ballot.
 * 5. Position and candidate IDs must belong to the given election.
 * 6. Votes per position must NOT exceed position.seats (Fixes C1: ballot stuffing).
 * 7. Candidate choices within the same position must be distinct (cannot vote for same candidate twice).
 * 8. Votes table has no user link and no castAt timestamp to prevent timing attacks (Fixes C2: ballot secrecy).
 */
export const castVote = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const electionId = uuidParam(req.params.electionId, "Election");
  const voterId = req.user!.userId;
  const b = body(req.body);
  const rawSelections = array(b.selections, "selections", 100);

  if (rawSelections.length === 0) {
    throw badRequest("Selections array is required with at least one vote choice.");
  }

  // Parse and validate each selection item
  const selections: VoteChoice[] = rawSelections.map((item, index) => {
    if (!item || typeof item !== "object") {
      throw badRequest(`Selection at index ${index} must be an object with positionId and candidateId.`);
    }
    const sel = item as Record<string, unknown>;
    const posId = uuidField(sel.positionId, `Selection[${index}].positionId`);
    let candId: string | null = null;
    if (sel.candidateId !== null && sel.candidateId !== undefined) {
      candId = uuidField(sel.candidateId, `Selection[${index}].candidateId`);
    }
    return { positionId: posId, candidateId: candId };
  });

  // 1. Fetch Election and check status & time window
  const election = await db.orm.public.Election.where({ id: electionId }).first();
  if (!election) {
    throw notFound("Election not found");
  }

  if (election.status !== "OPEN") {
    throw badRequest(`Election is not open for voting. Current status: ${election.status}`);
  }

  const currentInstant = now();
  const currentEpochMs = currentInstant.epochMilliseconds;

  // Convert startsAt / endsAt safely (supports both Temporal.Instant or Date)
  const startEpochMs = (election.startsAt as any)?.epochMilliseconds ?? new Date(election.startsAt).getTime();
  const endEpochMs = (election.endsAt as any)?.epochMilliseconds ?? new Date(election.endsAt).getTime();

  if (currentEpochMs < startEpochMs) {
    throw badRequest("Voting has not yet started for this election.");
  }
  if (currentEpochMs > endEpochMs) {
    throw badRequest("Voting has ended for this election.");
  }

  // 2. Check Voter Eligibility
  const rollEntry = await db.orm.public.VoterRoll.where({
    electionId,
    userId: voterId,
  }).first();

  if (!rollEntry) {
    throw forbidden("You are not registered on the voter roll for this election.");
  }

  // 3. Fast pre-check for previous ballot
  const existingBallot = await db.orm.public.Ballot.where({
    electionId,
    userId: voterId,
  }).first();

  if (existingBallot) {
    throw conflict("You have already cast your ballot in this election.");
  }

  // 4. Validate Positions and Candidates
  const electionPositions = await db.orm.public.Position.where({ electionId })
    .include("candidates")
    .all();

  const positionMap = new Map<string, any>();
  for (const p of electionPositions) {
    positionMap.set(p.id, p);
  }

  // Enforce position validity and seat limits (Fix C1)
  const votesPerPosition = new Map<string, Set<string | null>>();
  for (const sel of selections) {
    const position = positionMap.get(sel.positionId);
    if (!position) {
      throw badRequest(`Position ID ${sel.positionId} does not belong to this election.`);
    }

    if (!votesPerPosition.has(sel.positionId)) {
      votesPerPosition.set(sel.positionId, new Set());
    }

    const candidateSet = votesPerPosition.get(sel.positionId)!;

    if (sel.candidateId) {
      // Validate candidate runs for this position
      const candidateExists = position.candidates.some((c: any) => c.id === sel.candidateId);
      if (!candidateExists) {
        throw badRequest(`Candidate ${sel.candidateId} does not run for position ${position.title}.`);
      }

      // Check for duplicate vote for same candidate in this position
      if (candidateSet.has(sel.candidateId)) {
        throw badRequest(`Duplicate vote choice: you cannot vote for the same candidate multiple times.`);
      }
      candidateSet.add(sel.candidateId);
    } else {
      // Abstain: one abstention per position. Candidate ids are UUIDs, so this
      // sentinel can never be mistaken for one.
      if (candidateSet.has(ABSTENTION)) {
        throw badRequest(`You can abstain from position ${position.title} only once.`);
      }
      candidateSet.add(ABSTENTION);
    }

    // Verify seat limit for this position
    if (candidateSet.size > position.seats) {
      throw badRequest(`Too many votes for position ${position.title}. Maximum allowed: ${position.seats}.`);
    }
  }

  // Every position must appear on the ballot, even if only as an abstention.
  // Without this, a truncated payload quietly drops the positions the voter
  // never got round to choosing, and the ballot is counted as complete.
  for (const position of electionPositions) {
    if (!votesPerPosition.has(position.id)) {
      throw badRequest(
        `Position "${position.title}" is missing from your ballot. Send it with candidateId set to null to abstain.`,
      );
    }
  }

  // 5. Generate cryptographically strong unique Receipt Code
  // The whole code is uppercase so it matches the normalised lookup in
  // verifyBallotReceipt, which uppercases whatever the caller types.
  const randomHex = crypto.randomBytes(8).toString("hex").toUpperCase();
  const receiptCode = `REC-${electionId.slice(0, 4).toUpperCase()}-${randomHex}`;

  // 6. ATOMIC TRANSACTION: Insert Ballot + Votes
  // Unbiased Fisher-Yates shuffle to decouple storage order from ballot receipt
  const shuffledVotes = [...selections];
  for (let i = shuffledVotes.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [shuffledVotes[i], shuffledVotes[j]] = [shuffledVotes[j], shuffledVotes[i]];
  }

  try {
    await db.transaction(async (tx) => {
      // Record THAT the user voted
      await tx.orm.public.Ballot.create({
        electionId,
        userId: voterId,
        receiptCode,
        castAt: currentInstant as any,
      });

      // Record WHAT was chosen: no userId, no ballotId and no timestamp of any
      // kind, so a vote row cannot be tied back to a ballot.
      for (const sel of shuffledVotes) {
        await tx.orm.public.Vote.create({
          electionId,
          positionId: sel.positionId,
          candidateId: sel.candidateId || null,
        });
      }
    });
  } catch (error: unknown) {
    // Two different unique constraints can fire here, and telling them apart is
    // the difference between blaming the voter and blaming us.
    if (isUniqueViolation(error, "ballots_electionId_userId_key")) {
      throw conflict("You have already cast your ballot in this election.");
    }
    if (isUniqueViolation(error, "ballots_receiptCode_key")) {
      throw conflict("Could not issue a receipt code. Please cast your ballot again.");
    }
    throw error;
  }

  res.status(201).json({
    message: "Vote cast successfully and recorded.",
    receiptCode,
    electionId,
  });
});

/**
 * Public ballot receipt verification endpoint.
 * Proves that a ballot was accepted and counted without disclosing voter identity or choices.
 */
export const verifyBallotReceipt = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const electionId = uuidParam(req.params.electionId, "Election");
  const rawReceipt = req.params.receiptCode;

  if (typeof rawReceipt !== "string" || !rawReceipt.trim()) {
    throw badRequest("Receipt code is required.");
  }

  const receiptCode = rawReceipt.trim().toUpperCase();

  const ballot = await db.orm.public.Ballot.where({
    electionId,
    receiptCode,
  }).first();

  if (!ballot) {
    throw notFound("Invalid receipt code. No matching ballot found for this election.");
  }

  res.status(200).json({
    verified: true,
    message: "Ballot verified. Your vote is securely recorded and counted.",
    electionId: ballot.electionId,
    receiptCode: ballot.receiptCode,
  });
});
