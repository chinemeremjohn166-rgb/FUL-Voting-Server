import type { Request, Response } from "express";
import { db } from "../prisma/db.ts";
import { logAudit } from "../lib/audit.ts";
import { uuidParam, isUuid, body, array } from "../lib/validation.ts";
import { asyncHandler, badRequest, notFound } from "../lib/http.ts";

export const addVotersToRoll = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const electionId = uuidParam(req.params.electionId, "Election");
  const b = body(req.body);
  const rawUserIds = array(b.userIds, "userIds", 5000);
  const rawMatricNumbers = array(b.matricNumbers, "matricNumbers", 5000);
  const adminId = req.user!.userId;

  const election = await db.orm.public.Election.where({ id: electionId }).first();
  if (!election) {
    throw notFound("Election not found");
  }

  // Voter roll changes must be locked once election leaves DRAFT (Fix C5)
  if (election.status !== "DRAFT") {
    throw badRequest("Voter roll can only be modified while the election is in DRAFT status.");
  }

  const validUserIds = new Set<string>();
  const notFoundMatrics: string[] = [];
  const notFoundUserIds: string[] = [];

  // 1. Resolve every supplied user id and matriculation number in one query each
  // instead of one per entry (Fix: N+1 lookups on a 5000-row batch).
  const requestedIds = rawUserIds.map((item) => {
    if (typeof item !== "string" || !isUuid(item)) {
      throw badRequest(`Invalid userId in array: ${String(item)}`);
    }
    return item.toLowerCase();
  });

  if (requestedIds.length > 0) {
    const found = await db.orm.public.User.where((u) => u.id.in(requestedIds))
      .select("id")
      .all();
    const matched = new Set(found.map((user: any) => user.id));
    for (const id of requestedIds) {
      if (matched.has(id)) validUserIds.add(id);
      else notFoundUserIds.push(id);
    }
  }

  const matrics = rawMatricNumbers
    .filter((item) => typeof item === "string" && item.trim())
    .map((item) => (item as string).trim().toUpperCase());

  if (matrics.length > 0) {
    const found = await db.orm.public.User.where((u) => u.matricNo.in(matrics))
      .select("id", "matricNo")
      .all();
    const matched = new Map(found.map((user: any) => [user.matricNo, user.id]));
    for (const matric of matrics) {
      const id = matched.get(matric);
      if (id) validUserIds.add(id);
      else notFoundMatrics.push(matric);
    }
  }

  if (validUserIds.size === 0 && (notFoundMatrics.length > 0 || notFoundUserIds.length > 0)) {
    throw badRequest("No valid users found for the provided IDs or matriculation numbers.", {
      notFoundMatrics,
      notFoundUserIds,
    });
  }

  // 2. Atomic insertion of voter roll entries inside a transaction (Fix M3)
  let addedCount = 0;
  let alreadyOnRollCount = 0;

  await db.transaction(async (tx) => {
    const idsToAdd = [...validUserIds];

    // One query tells us who is already on the roll.
    const already = idsToAdd.length
      ? await tx.orm.public.VoterRoll.where({ electionId })
          .where((r) => r.userId.in(idsToAdd))
          .select("userId")
          .all()
      : [];
    const onRoll = new Set(already.map((entry: any) => entry.userId));

    for (const uId of idsToAdd) {
      if (onRoll.has(uId)) {
        alreadyOnRollCount++;
        continue;
      }
      await tx.orm.public.VoterRoll.create({
        electionId,
        userId: uId,
      });
      addedCount++;
    }

    if (addedCount > 0) {
      await logAudit(
        {
          actorId: adminId,
          action: "VOTERS_ADDED_TO_ROLL",
          entity: "VoterRoll",
          metadata: { electionId, count: addedCount },
        },
        tx
      );
    }
  });

  res.status(200).json({
    message: `Successfully added ${addedCount} voter(s) to the roll.`,
    totalAdded: addedCount,
    alreadyOnRoll: alreadyOnRollCount,
    notFoundMatrics: notFoundMatrics.length > 0 ? notFoundMatrics : undefined,
    notFoundUserIds: notFoundUserIds.length > 0 ? notFoundUserIds : undefined,
  });
});

export const getVoterRoll = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const electionId = uuidParam(req.params.electionId, "Election");

  const election = await db.orm.public.Election.where({ id: electionId }).first();
  if (!election) {
    throw notFound("Election not found");
  }

  const roll = await db.orm.public.VoterRoll.where({ electionId })
    .orderBy([(r) => r.addedAt.asc(), (r) => r.id.asc()])
    .include("user")
    .all();

  const sanitized = roll.map((entry: any) => ({
    id: entry.id,
    userId: entry.userId,
    addedAt: entry.addedAt,
    user: {
      fullName: entry.user.fullName,
      email: entry.user.email,
      matricNo: entry.user.matricNo,
    },
  }));

  res.status(200).json({ voterRoll: sanitized, totalCount: sanitized.length });
});

export const removeVoterFromRoll = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const electionId = uuidParam(req.params.electionId, "Election");
  const userId = uuidParam(req.params.userId, "User");
  const adminId = req.user!.userId;

  const election = await db.orm.public.Election.where({ id: electionId }).first();
  if (!election) {
    throw notFound("Election not found");
  }

  // Voter roll deletions must be locked once election leaves DRAFT (Fix C5)
  if (election.status !== "DRAFT") {
    throw badRequest("Voters can only be removed while the election is in DRAFT status.");
  }

  const entry = await db.orm.public.VoterRoll.where({ electionId, userId }).first();
  if (!entry) {
    throw notFound("Voter is not in this election's roll.");
  }

  await db.orm.public.VoterRoll.where({ id: entry.id }).delete();

  await logAudit({
    actorId: adminId,
    action: "VOTER_REMOVED_FROM_ROLL",
    entity: "VoterRoll",
    entityId: entry.id,
    metadata: { electionId, userId },
  });

  res.status(200).json({ message: "Voter removed from roll successfully" });
});
