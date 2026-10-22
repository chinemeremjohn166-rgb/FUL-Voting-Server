import type { Request, Response } from "express";
import { db } from "../prisma/db.ts";
import { logAudit } from "../lib/audit.ts";
import { uuidParam, str, int, body } from "../lib/validation.ts";
import { asyncHandler, badRequest, notFound } from "../lib/http.ts";

export const createPosition = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const electionId = uuidParam(req.params.electionId, "Election");
  const b = body(req.body);
  const adminId = req.user!.userId;

  const title = str(b.title, "Position title", { required: true, min: 2, max: 100 })!;
  const seats = b.seats !== undefined ? int(b.seats, "Seats", 1, 100) : 1;
  const requestedOrder = b.order !== undefined ? int(b.order, "Order", 0, 10000) : undefined;

  const election = await db.orm.public.Election.where({ id: electionId }).first();
  if (!election) {
    throw notFound("Election not found");
  }

  if (election.status !== "DRAFT") {
    throw badRequest("Positions can only be added to DRAFT elections.");
  }

  // Positions join the end of the ballot unless the caller picks a slot. A
  // shared default of 0 left every position tied, so ballot order was arbitrary.
  let order = requestedOrder;
  if (order === undefined) {
    const { top } = await db.orm.public.Position.where({ electionId }).aggregate((aggregate) => ({
      top: aggregate.max("order"),
    }));
    order = (top ?? -1) + 1;
  }

  const position = await db.orm.public.Position.create({
    electionId,
    title,
    seats,
    order,
  });

  await logAudit({
    actorId: adminId,
    action: "POSITION_CREATED",
    entity: "Position",
    entityId: position.id,
    metadata: { electionId, title: position.title, seats },
  });

  res.status(201).json({ message: "Position created successfully", position });
});

export const getPositionsByElection = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const electionId = uuidParam(req.params.electionId, "Election");
  const isAdmin = req.user?.role === "ADMIN";

  const election = await db.orm.public.Election.where({ id: electionId }).first();
  if (!election) {
    throw notFound("Election not found");
  }

  if (!isAdmin && election.status === "DRAFT") {
    throw notFound("Election not found");
  }

  const positions = await db.orm.public.Position.where({ electionId })
    .orderBy([(p) => p.order.asc(), (p) => p.id.asc()])
    .include("candidates", (candidates) =>
      candidates.orderBy([(c) => c.order.asc(), (c) => c.id.asc()]),
    )
    .all();

  res.status(200).json({ positions });
});

export const updatePosition = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const id = uuidParam(req.params.id, "Position");
  const b = body(req.body);
  const adminId = req.user!.userId;

  const position = await db.orm.public.Position.where({ id }).first();
  if (!position) {
    throw notFound("Position not found");
  }

  // Lock modifications if election is not in DRAFT (Fix C5)
  const election = await db.orm.public.Election.where({ id: position.electionId }).first();
  if (!election || election.status !== "DRAFT") {
    throw badRequest("Positions can only be modified while the election is in DRAFT status.");
  }

  const updateData: Record<string, any> = {};
  if (b.title !== undefined) {
    updateData.title = str(b.title, "Position title", { required: true, min: 2, max: 100 });
  }
  if (b.seats !== undefined) {
    updateData.seats = int(b.seats, "Seats", 1, 100);
  }
  if (b.order !== undefined) {
    updateData.order = int(b.order, "Order", 0, 10000);
  }

  if (Object.keys(updateData).length > 0) {
    await db.orm.public.Position.where({ id }).update(updateData);

    await logAudit({
      actorId: adminId,
      action: "POSITION_UPDATED",
      entity: "Position",
      entityId: id,
      metadata: updateData,
    });
  }

  const updated = await db.orm.public.Position.where({ id }).first();
  res.status(200).json({ message: "Position updated successfully", position: updated });
});

export const deletePosition = asyncHandler(async (req: Request, res: Response): Promise<void> => {
  const id = uuidParam(req.params.id, "Position");
  const adminId = req.user!.userId;

  const position = await db.orm.public.Position.where({ id }).first();
  if (!position) {
    throw notFound("Position not found");
  }

  // Lock deletions if election is not in DRAFT (Fix C5)
  const election = await db.orm.public.Election.where({ id: position.electionId }).first();
  if (!election || election.status !== "DRAFT") {
    throw badRequest("Positions can only be deleted while the election is in DRAFT status.");
  }

  await db.orm.public.Position.where({ id }).delete();

  await logAudit({
    actorId: adminId,
    action: "POSITION_DELETED",
    entity: "Position",
    entityId: id,
    metadata: { electionId: position.electionId, title: position.title },
  });

  res.status(200).json({ message: "Position deleted successfully" });
});
