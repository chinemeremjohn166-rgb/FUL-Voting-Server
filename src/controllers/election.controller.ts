import type { Request, Response } from "express";
import { db } from "../prisma/db.ts";
import { logAudit } from "../lib/audit.ts";
import { uuidParam, str, instant, body } from "../lib/validation.ts";
import { asyncHandler, badRequest, forbidden, notFound } from "../lib/http.ts";
import { now } from "../lib/temporal.ts";

export const createElection = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const b = body(req.body);
  const adminId = req.user!.userId;

  const title = str(b.title, "Title", { required: true, min: 3, max: 200 })!;
  const description = str(b.description, "Description", { max: 2000 }) ?? null;
  const startInstant = instant(b.startsAt, "startsAt");
  const endInstant = instant(b.endsAt, "endsAt");

  if (endInstant.epochMilliseconds <= startInstant.epochMilliseconds) {
    throw badRequest("endsAt must be after startsAt.");
  }

  const election = await db.orm.public.Election.create({
    title,
    description,
    status: "DRAFT",
    startsAt: startInstant as any,
    endsAt: endInstant as any,
    createdById: adminId,
  });

  await logAudit({
    actorId: adminId,
    action: "ELECTION_CREATED",
    entity: "Election",
    entityId: election.id,
    metadata: { title: election.title },
  });

  res.status(201).json({ message: "Election created successfully", election });
});

export const getElections = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const isAdmin = req.user?.role === "ADMIN";
  const statusQuery = typeof req.query.status === "string" ? req.query.status.toUpperCase() : undefined;

  let elections;
  if (isAdmin) {
    if (statusQuery) {
      elections = await db.orm.public.Election.where({ status: statusQuery as any })
        .orderBy([(e) => e.startsAt.asc(), (e) => e.id.asc()])
        .all();
    } else {
      elections = await db.orm.public.Election.orderBy([(e) => e.startsAt.asc(), (e) => e.id.asc()]).all();
    }
  } else {
    // Non-admin voters see OPEN, CLOSED, or PUBLISHED elections (Fix M9: show CLOSED to voters too)
    const validPublicStatuses = ["OPEN", "CLOSED", "PUBLISHED"] as const;
    if (statusQuery && (validPublicStatuses as readonly string[]).includes(statusQuery)) {
      elections = await db.orm.public.Election.where({ status: statusQuery as any })
        .orderBy([(e) => e.startsAt.asc(), (e) => e.id.asc()])
        .all();
    } else {
      const openElections = await db.orm.public.Election.where({ status: "OPEN" })
        .orderBy([(e) => e.startsAt.asc(), (e) => e.id.asc()])
        .all();
      const closedElections = await db.orm.public.Election.where({ status: "CLOSED" })
        .orderBy([(e) => e.startsAt.asc(), (e) => e.id.asc()])
        .all();
      const publishedElections = await db.orm.public.Election.where({ status: "PUBLISHED" })
        .orderBy([(e) => e.startsAt.asc(), (e) => e.id.asc()])
        .all();
      elections = [...openElections, ...closedElections, ...publishedElections];
    }
  }

  res.status(200).json({ elections });
});

export const getElectionById = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const id = uuidParam(req.params.id, "Election");
  const userId = req.user?.userId;
  const isAdmin = req.user?.role === "ADMIN";

  const election = await db.orm.public.Election.where({ id })
    .include("positions", (positions) =>
      positions
        .orderBy([(p) => p.order.asc(), (p) => p.id.asc()])
        .include("candidates", (candidates) =>
          candidates.orderBy([(c) => c.order.asc(), (c) => c.id.asc()]),
        ),
    )
    .first();

  if (!election) {
    throw notFound("Election not found");
  }

  // Non-admins must not inspect DRAFT elections (Fix H8)
  if (!isAdmin && election.status === "DRAFT") {
    throw notFound("Election not found");
  }

  // Check voter eligibility & hasVoted if user is authenticated
  let isEligible = false;
  let hasVoted = false;

  if (userId) {
    const rollEntry = await db.orm.public.VoterRoll.where({ electionId: id, userId }).first();
    isEligible = !!rollEntry;

    const ballot = await db.orm.public.Ballot.where({ electionId: id, userId }).first();
    hasVoted = !!ballot;
  }

  res.status(200).json({
    election,
    viewerStatus: {
      isEligible,
      hasVoted,
    },
  });
});

export const updateElection = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const id = uuidParam(req.params.id, "Election");
  const b = body(req.body);
  const adminId = req.user!.userId;

  const election = await db.orm.public.Election.where({ id }).first();
  if (!election) {
    throw notFound("Election not found");
  }

  if (election.status !== "DRAFT") {
    throw badRequest("Only elections in DRAFT status can be modified.");
  }

  const updatePayload: Record<string, any> = {};

  if (b.title !== undefined) {
    updatePayload.title = str(b.title, "Title", { required: true, min: 3, max: 200 });
  }
  if (b.description !== undefined) {
    updatePayload.description = str(b.description, "Description", { max: 2000 }) ?? null;
  }

  // Validate dates if either startsAt or endsAt is supplied (Fix H9)
  let newStart = b.startsAt !== undefined ? instant(b.startsAt, "startsAt") : null;
  let newEnd = b.endsAt !== undefined ? instant(b.endsAt, "endsAt") : null;

  const currentStartEpoch = (election.startsAt as any)?.epochMilliseconds ?? new Date(election.startsAt).getTime();
  const currentEndEpoch = (election.endsAt as any)?.epochMilliseconds ?? new Date(election.endsAt).getTime();

  const effectiveStartEpoch = newStart ? newStart.epochMilliseconds : currentStartEpoch;
  const effectiveEndEpoch = newEnd ? newEnd.epochMilliseconds : currentEndEpoch;

  if (effectiveEndEpoch <= effectiveStartEpoch) {
    throw badRequest("endsAt must be after startsAt.");
  }

  if (newStart) updatePayload.startsAt = newStart as any;
  if (newEnd) updatePayload.endsAt = newEnd as any;

  if (Object.keys(updatePayload).length > 0) {
    await db.orm.public.Election.where({ id }).update(updatePayload);

    await logAudit({
      actorId: adminId,
      action: "ELECTION_UPDATED",
      entity: "Election",
      entityId: id,
      metadata: updatePayload,
    });
  }

  const updated = await db.orm.public.Election.where({ id }).first();
  res.status(200).json({ message: "Election updated successfully", election: updated });
});

/**
 * Strict state machine transition (Fix C4):
 * DRAFT -> OPEN (requires >= 1 position with >= 1 candidate)
 * OPEN -> CLOSED
 * CLOSED -> PUBLISHED
 * All other transitions are rejected.
 */
const ALLOWED_TRANSITIONS: Record<string, string[]> = {
  DRAFT: ["OPEN"],
  OPEN: ["CLOSED"],
  CLOSED: ["PUBLISHED"],
  PUBLISHED: [],
};

export const changeElectionStatus = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const id = uuidParam(req.params.id, "Election");
  const b = body(req.body);
  const targetStatus = str(b.status, "Status", { required: true })?.toUpperCase();
  const adminId = req.user!.userId;

  const validStatuses = ["DRAFT", "OPEN", "CLOSED", "PUBLISHED"];
  if (!targetStatus || !validStatuses.includes(targetStatus)) {
    throw badRequest(`Invalid status. Must be one of: ${validStatuses.join(", ")}`);
  }

  const election = await db.orm.public.Election.where({ id }).first();
  if (!election) {
    throw notFound("Election not found");
  }

  const currentStatus = election.status;
  const allowedNext = ALLOWED_TRANSITIONS[currentStatus] || [];

  if (!allowedNext.includes(targetStatus)) {
    throw badRequest(
      `Illegal election status transition from ${currentStatus} to ${targetStatus}. Allowed transitions: ${
        allowedNext.length > 0 ? allowedNext.join(", ") : "None (terminal state)"
      }`
    );
  }

  // Pre-conditions for opening an election
  if (targetStatus === "OPEN") {
    const positions = await db.orm.public.Position.where({ electionId: id })
      .include("candidates")
      .all();

    if (positions.length === 0) {
      throw badRequest("Cannot open election: at least one position must be created.");
    }

    for (const pos of positions) {
      if (pos.candidates.length === 0) {
        throw badRequest(`Cannot open election: position "${pos.title}" has no candidates.`);
      }
    }
  }

  const updateData: Record<string, any> = { status: targetStatus };
  if (targetStatus === "PUBLISHED") {
    updateData.publishedAt = now() as any;
  }

  await db.orm.public.Election.where({ id }).update(updateData);

  await logAudit({
    actorId: adminId,
    action: "ELECTION_STATUS_CHANGED",
    entity: "Election",
    entityId: id,
    metadata: { previousStatus: currentStatus, newStatus: targetStatus },
  });

  res.status(200).json({ message: `Election status changed to ${targetStatus}`, status: targetStatus });
});

export const deleteElection = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const id = uuidParam(req.params.id, "Election");
  const adminId = req.user!.userId;

  const election = await db.orm.public.Election.where({ id }).first();
  if (!election) {
    throw notFound("Election not found");
  }

  if (election.status !== "DRAFT") {
    throw badRequest("Only DRAFT elections can be deleted. Ongoing or completed elections cannot be destroyed.");
  }

  await db.orm.public.Election.where({ id }).delete();

  await logAudit({
    actorId: adminId,
    action: "ELECTION_DELETED",
    entity: "Election",
    entityId: id,
  });

  res.status(200).json({ message: "Election deleted successfully" });
});
