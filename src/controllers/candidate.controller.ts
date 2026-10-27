import type { Request, Response } from "express";
import { db } from "../prisma/db.ts";
import { logAudit } from "../lib/audit.ts";
import { uuidParam, str, int, httpUrl, body } from "../lib/validation.ts";
import { asyncHandler, badRequest, notFound } from "../lib/http.ts";

export const createCandidate = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const positionId = uuidParam(req.params.positionId, "Position");
  const b = body(req.body);
  const adminId = req.user!.userId;

  const fullName = str(b.fullName, "Candidate Full Name", { required: true, min: 2, max: 100 })!;
  const manifesto = str(b.manifesto, "Manifesto", { max: 10000 }) ?? null;
  const photoUrl = b.photoUrl !== undefined ? httpUrl(b.photoUrl, "Photo URL") : null;
  const requestedOrder = b.order !== undefined ? int(b.order, "Order", 0, 10000) : undefined;

  const position = await db.orm.public.Position.where({ id: positionId })
    .include("election")
    .first();

  if (!position) {
    throw notFound("Position not found");
  }

  // Lock modifications if election is not in DRAFT (Fix C5)
  if (position.election.status !== "DRAFT") {
    throw badRequest("Candidates can only be added while the election is in DRAFT status.");
  }

  // Candidates join the end of their position unless the caller picks a slot.
  const candidate = await db.transaction(async (tx) => {
    let order = requestedOrder;
    if (order === undefined) {
      const { top } = await tx.orm.public.Candidate.where({ positionId }).aggregate((aggregate) => ({
        top: aggregate.max("order"),
      }));
      order = (top ?? -1) + 1;
    }

    const created = await tx.orm.public.Candidate.create({
      positionId,
      fullName,
      manifesto,
      photoUrl,
      order,
    });

    await logAudit(
      {
        actorId: adminId,
        action: "CANDIDATE_CREATED",
        entity: "Candidate",
        entityId: created.id,
        metadata: { positionId, fullName: created.fullName },
      },
      tx,
    );

    return created;
  });

  res.status(201).json({ message: "Candidate created successfully", candidate });
});

export const getCandidatesByPosition = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const positionId = uuidParam(req.params.positionId, "Position");
  const isAdmin = req.user?.role === "ADMIN";

  const position = await db.orm.public.Position.where({ id: positionId })
    .include("election")
    .first();

  if (!position) {
    throw notFound("Position not found");
  }

  if (!isAdmin && position.election.status === "DRAFT") {
    throw notFound("Position not found");
  }

  const candidates = await db.orm.public.Candidate.where({ positionId })
    .orderBy([(c) => c.order.asc(), (c) => c.id.asc()])
    .all();

  res.status(200).json({ candidates });
});

export const updateCandidate = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const id = uuidParam(req.params.id, "Candidate");
  const b = body(req.body);
  const adminId = req.user!.userId;

  const candidate = await db.orm.public.Candidate.where({ id })
    .include("position", (p) => p.include("election"))
    .first();

  if (!candidate) {
    throw notFound("Candidate not found");
  }

  // Lock modifications if election is not in DRAFT (Fix C5)
  if (!candidate.position || candidate.position.election.status !== "DRAFT") {
    throw badRequest("Candidates can only be updated while the election is in DRAFT status.");
  }

  const updateData: Record<string, any> = {};
  if (b.fullName !== undefined) {
    updateData.fullName = str(b.fullName, "Candidate Full Name", { required: true, min: 2, max: 100 });
  }
  if (b.manifesto !== undefined) {
    updateData.manifesto = str(b.manifesto, "Manifesto", { max: 10000 }) ?? null;
  }
  if (b.photoUrl !== undefined) {
    updateData.photoUrl = httpUrl(b.photoUrl, "Photo URL");
  }
  if (b.order !== undefined) {
    updateData.order = int(b.order, "Order", 0, 10000);
  }

  if (Object.keys(updateData).length > 0) {
    await db.orm.public.Candidate.where({ id }).update(updateData);

    await logAudit({
      actorId: adminId,
      action: "CANDIDATE_UPDATED",
      entity: "Candidate",
      entityId: id,
      metadata: updateData,
    });
  }

  const updated = await db.orm.public.Candidate.where({ id }).first();
  res.status(200).json({ message: "Candidate updated successfully", candidate: updated });
});

export const deleteCandidate = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const id = uuidParam(req.params.id, "Candidate");
  const adminId = req.user!.userId;

  const candidate = await db.orm.public.Candidate.where({ id })
    .include("position", (p) => p.include("election"))
    .first();

  if (!candidate) {
    throw notFound("Candidate not found");
  }

  // Lock deletions if election is not in DRAFT (Fix C5)
  if (!candidate.position || candidate.position.election.status !== "DRAFT") {
    throw badRequest("Candidates can only be deleted while the election is in DRAFT status.");
  }

  await db.orm.public.Candidate.where({ id }).delete();

  await logAudit({
    actorId: adminId,
    action: "CANDIDATE_DELETED",
    entity: "Candidate",
    entityId: id,
    metadata: { positionId: candidate.positionId, fullName: candidate.fullName },
  });

  res.status(200).json({ message: "Candidate deleted successfully" });
});
