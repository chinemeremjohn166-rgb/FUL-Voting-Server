/**
 * ============================================================================
 * VOTING APPLICATION API — MASTER TEACHING & IMPLEMENTATION GUIDE (teach.ts)
 * ============================================================================
 *
 * This file serves as the definitive architecture manual and step-by-step
 * implementation guide for the Voting API application.
 *
 * NOTE: Per instructions, NO existing files in the repository have been modified.
 * This file documents:
 *  1. Architectural Overview & Security Foundation
 *  2. Existing Codebase Audit & Detected Bugs
 *  3. File-by-File Blueprint (What to do, Where to do it, and Exact Code)
 *  4. Complete REST API Specification Table
 *  5. End-to-End Testing & Verification Workflow
 * ============================================================================
 */

export interface TeachingModule {
  section: string;
  title: string;
  description: string;
}




export const FILE_IMPLEMENTATIONS = {
 
  

  // --------------------------------------------------------------------------
  // FILE 3: src/lib/audit.ts (NEW FILE)
  // --------------------------------------------------------------------------
  "src/lib/audit.ts": {
    action: "CREATE",
    purpose: "Audit logging utility to record administrative actions in database.",
    code: `
import { db } from "../prisma/db.ts";

export interface AuditParams {
  actorId: string;
  action: string;
  entity: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}

export const logAudit = async ({
  actorId,
  action,
  entity,
  entityId,
  metadata,
}: AuditParams): Promise<void> => {
  try {
    await db.orm.public.AuditLog.create({
      actorId,
      action,
      entity,
      entityId: entityId || null,
      metadata: metadata ? JSON.stringify(metadata) : null,
    });
  } catch (error) {
    console.error("Failed to write audit log:", error);
    // Non-fatal: do not block request execution
  }
};
`,
  },

  // --------------------------------------------------------------------------
  // FILE 4: src/controllers/auth.controller.ts (changes)
  // --------------------------------------------------------------------------
  "src/controllers/auth.controller.ts": {
    action: "MODIFY",
    purpose: "User registration, login, logout, and profile endpoints.",
    code: `
import type { Request, Response } from "express";
import bcrypt from "bcrypt";
import { validateField, validateEmail, validatePassword } from "../lib/validation.ts";
import { db } from "../prisma/db.ts";
import { signToken } from "../lib/auth.ts";

export const registerUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password, fullname, matricNo } = req.body;

    if (!email) {
      res.status(400).json({ message: "Email address is required" });
      return;
    }

    const cleanEmail = email.trim().toLowerCase();
    const emailError = validateEmail(cleanEmail);
    const nameError = validateField(fullname, "Full Name");
    const matricNoError = matricNo ? null : validateField(matricNo, "Matric No");
    const passwordError = validatePassword(password);

    if (emailError) {
      res.status(400).json({ message: emailError });
      return;
    }
    if (nameError) {
      res.status(400).json({ message: nameError });
      return;
    }
    if (matricNoError) {
      res.status(400).json({ message: matricNoError });
      return;
    }
    if (passwordError) {
      res.status(400).json({ message: passwordError });
      return;
    }

    // Check existing email
    const existingEmail = await db.orm.public.User.where({ email: cleanEmail }).first();
    if (existingEmail) {
      res.status(409).json({ message: "An account with this email already exists" });
      return;
    }

    // Check existing matricNo if provided
    if (matricNo) {
      const existingMatric = await db.orm.public.User.where({ matricNo }).first();
      if (existingMatric) {
        res.status(409).json({ message: "An account with this Matric No already exists" });
        return;
      }
    }

    // Hash password
    const salt = bcrypt.genSaltSync(10);
    const hashedPassword = bcrypt.hashSync(password, salt);

    // Create user
    const user = await db.orm.public.User.create({
      email: cleanEmail,
      passwordHash: hashedPassword,
      fullName: fullname,
      matricNo: matricNo || null,
      role: "VOTER",
    });

    const token = signToken({
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    // Set cookie BEFORE sending json response!
    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 24 * 60 * 60 * 1000,
    });

    res.status(201).json({
      message: "User registered successfully",
      token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        matricNo: user.matricNo,
        role: user.role,
        createdAt: user.createdAt,
      },
    });
  } catch (error: any) {
    res.status(500).json({ message: "Internal server error during registration", error: error.message });
  }
};

export const loginUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { identifier, password } = req.body;
    // identifier can be either email or matricNo

    if (!identifier || !password) {
      res.status(400).json({ message: "Email/Matric No and Password are required" });
      return;
    }

    const cleanIdentifier = identifier.trim().toLowerCase();

    // Query user by email or matricNo
    let user = await db.orm.public.User.where({ email: cleanIdentifier }).first();
    if (!user) {
      user = await db.orm.public.User.where({ matricNo: identifier.trim() }).first();
    }

    if (!user) {
      res.status(401).json({ message: "Invalid credentials" });
      return;
    }

    const isPasswordValid = bcrypt.compareSync(password, user.passwordHash);
    if (!isPasswordValid) {
      res.status(401).json({ message: "Invalid credentials" });
      return;
    }

    const token = signToken({
      userId: user.id,
      email: user.email,
      role: user.role,
    });

    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "strict",
      maxAge: 24 * 60 * 60 * 1000,
    });

    res.status(200).json({
      message: "Login successful",
      token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        matricNo: user.matricNo,
        role: user.role,
      },
    });
  } catch (error: any) {
    res.status(500).json({ message: "Internal server error during login", error: error.message });
  }
};

export const getCurrentUser = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.user) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const user = await db.orm.public.User.where({ id: req.user.userId }).first();
    if (!user) {
      res.status(404).json({ message: "User not found" });
      return;
    }

    res.status(200).json({
      user: {
        id: user.id,
        email: user.email,
        fullName: user.fullName,
        matricNo: user.matricNo,
        role: user.role,
        createdAt: user.createdAt,
      },
    });
  } catch (error: any) {
    res.status(500).json({ message: "Internal server error", error: error.message });
  }
};

export const logoutUser = (_req: Request, res: Response): void => {
  res.clearCookie("token");
  res.status(200).json({ message: "Logged out successfully" });
};
`,
  },

  // --------------------------------------------------------------------------
  // FILE 5: src/routes/auth.routes.ts (Auth Routes)
  // --------------------------------------------------------------------------
  "src/routes/auth.routes.ts": {
    action: "MODIFY",
    purpose: "Defines auth endpoints and middleware wiring.",
    code: `
import { Router } from "express";
import { registerUser, loginUser, getCurrentUser, logoutUser } from "../controllers/auth.controller.ts";
import { authenticate } from "../middlewares/auth.middleware.ts";

const router: Router = Router();

router.post("/register", registerUser);
router.post("/login", loginUser);
router.get("/me", authenticate, getCurrentUser);
router.post("/logout", authenticate, logoutUser);

export default router;
`,
  },

  // --------------------------------------------------------------------------
  // FILE 6: src/controllers/election.controller.ts (NEW FILE)
  // --------------------------------------------------------------------------
  "src/controllers/election.controller.ts": {
    action: "CREATE",
    purpose: "Election lifecycle management (CRUD, status transitions, validation).",
    code: `
import type { Request, Response } from "express";
import { db } from "../prisma/db.ts";
import { logAudit } from "../lib/audit.ts";

export const createElection = async (req: Request, res: Response): Promise<void> => {
  try {
    const { title, description, startsAt, endsAt } = req.body;
    const adminId = req.user!.userId;

    if (!title || !startsAt || !endsAt) {
      res.status(400).json({ message: "Title, startsAt, and endsAt dates are required." });
      return;
    }

    const startDate = new Date(startsAt);
    const endDate = new Date(endsAt);

    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      res.status(400).json({ message: "Invalid date format for startsAt or endsAt." });
      return;
    }

    if (endDate <= startDate) {
      res.status(400).json({ message: "endsAt must be after startsAt." });
      return;
    }

    const election = await db.orm.public.Election.create({
      title: title.trim(),
      description: description ? description.trim() : null,
      status: "DRAFT",
      startsAt: startDate,
      endsAt: endDate,
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
  } catch (error: any) {
    res.status(500).json({ message: "Failed to create election", error: error.message });
  }
};

export const getElections = async (req: Request, res: Response): Promise<void> => {
  try {
    const isAdmin = req.user?.role === "ADMIN";
    const statusQuery = req.query.status as string | undefined;

    let elections;
    if (isAdmin) {
      if (statusQuery) {
        elections = await db.orm.public.Election.where({ status: statusQuery as any }).all();
      } else {
        elections = await db.orm.public.Election.all();
      }
    } else {
      // Voters only see OPEN or PUBLISHED elections
      if (statusQuery && (statusQuery === "OPEN" || statusQuery === "PUBLISHED")) {
        elections = await db.orm.public.Election.where({ status: statusQuery as any }).all();
      } else {
        const openElections = await db.orm.public.Election.where({ status: "OPEN" }).all();
        const publishedElections = await db.orm.public.Election.where({ status: "PUBLISHED" }).all();
        elections = [...openElections, ...publishedElections];
      }
    }

    res.status(200).json({ elections });
  } catch (error: any) {
    res.status(500).json({ message: "Failed to fetch elections", error: error.message });
  }
};

export const getElectionById = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const userId = req.user?.userId;

    const election = await db.orm.public.Election.where({ id })
      .include("positions", (p) => p.include("candidates"))
      .first();

    if (!election) {
      res.status(404).json({ message: "Election not found" });
      return;
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
  } catch (error: any) {
    res.status(500).json({ message: "Failed to fetch election details", error: error.message });
  }
};

export const updateElection = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { title, description, startsAt, endsAt } = req.body;
    const adminId = req.user!.userId;

    const election = await db.orm.public.Election.where({ id }).first();
    if (!election) {
      res.status(404).json({ message: "Election not found" });
      return;
    }

    if (election.status !== "DRAFT") {
      res.status(400).json({ message: "Only elections in DRAFT status can be modified." });
      return;
    }

    const updatePayload: Record<string, any> = {};
    if (title) updatePayload.title = title.trim();
    if (description !== undefined) updatePayload.description = description ? description.trim() : null;
    if (startsAt) updatePayload.startsAt = new Date(startsAt);
    if (endsAt) updatePayload.endsAt = new Date(endsAt);

    await db.orm.public.Election.where({ id }).update(updatePayload);

    await logAudit({
      actorId: adminId,
      action: "ELECTION_UPDATED",
      entity: "Election",
      entityId: id,
      metadata: updatePayload,
    });

    const updated = await db.orm.public.Election.where({ id }).first();
    res.status(200).json({ message: "Election updated successfully", election: updated });
  } catch (error: any) {
    res.status(500).json({ message: "Failed to update election", error: error.message });
  }
};

export const changeElectionStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const adminId = req.user!.userId;

    const validStatuses = ["DRAFT", "OPEN", "CLOSED", "PUBLISHED"];
    if (!validStatuses.includes(status)) {
      res.status(400).json({ message: \`Invalid status. Must be one of: \${validStatuses.join(", ")}\` });
      return;
    }

    const election = await db.orm.public.Election.where({ id }).first();
    if (!election) {
      res.status(404).json({ message: "Election not found" });
      return;
    }

    // State machine validation rules
    if (status === "OPEN") {
      // Must have at least 1 position
      const positions = await db.orm.public.Position.where({ electionId: id }).all();
      if (positions.length === 0) {
        res.status(400).json({ message: "Cannot open election: at least one position must be created." });
        return;
      }
    }

    const updateData: Record<string, any> = { status };
    if (status === "PUBLISHED") {
      updateData.publishedAt = new Date();
    }

    await db.orm.public.Election.where({ id }).update(updateData);

    await logAudit({
      actorId: adminId,
      action: "ELECTION_STATUS_CHANGED",
      entity: "Election",
      entityId: id,
      metadata: { previousStatus: election.status, newStatus: status },
    });

    res.status(200).json({ message: \`Election status changed to \${status}\`, status });
  } catch (error: any) {
    res.status(500).json({ message: "Failed to update election status", error: error.message });
  }
};

export const deleteElection = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const adminId = req.user!.userId;

    const election = await db.orm.public.Election.where({ id }).first();
    if (!election) {
      res.status(404).json({ message: "Election not found" });
      return;
    }

    if (election.status !== "DRAFT") {
      res.status(400).json({ message: "Only DRAFT elections can be deleted." });
      return;
    }

    await db.orm.public.Election.where({ id }).delete();

    await logAudit({
      actorId: adminId,
      action: "ELECTION_DELETED",
      entity: "Election",
      entityId: id,
    });

    res.status(200).json({ message: "Election deleted successfully" });
  } catch (error: any) {
    res.status(500).json({ message: "Failed to delete election", error: error.message });
  }
};
`,
  },

  // --------------------------------------------------------------------------
  // FILE 7: src/routes/election.routes.ts (NEW FILE)
  // --------------------------------------------------------------------------
  "src/routes/election.routes.ts": {
    action: "CREATE",
    purpose: "Election route configuration.",
    code: `
import { Router } from "express";
import {
  createElection,
  getElections,
  getElectionById,
  updateElection,
  changeElectionStatus,
  deleteElection,
} from "../controllers/election.controller.ts";
import { authenticate, requireAdmin } from "../middlewares/auth.middleware.ts";

const router: Router = Router();

router.get("/", authenticate, getElections);
router.get("/:id", authenticate, getElectionById);

// Admin-only management
router.post("/", authenticate, requireAdmin, createElection);
router.put("/:id", authenticate, requireAdmin, updateElection);
router.patch("/:id/status", authenticate, requireAdmin, changeElectionStatus);
router.delete("/:id", authenticate, requireAdmin, deleteElection);

export default router;
`,
  },

  // --------------------------------------------------------------------------
  // FILE 8: src/controllers/position.controller.ts (NEW FILE)
  // --------------------------------------------------------------------------
  "src/controllers/position.controller.ts": {
    action: "CREATE",
    purpose: "Manages positions (e.g. President, Vice President, Secretary).",
    code: `
import type { Request, Response } from "express";
import { db } from "../prisma/db.ts";
import { logAudit } from "../lib/audit.ts";

export const createPosition = async (req: Request, res: Response): Promise<void> => {
  try {
    const { electionId } = req.params;
    const { title, seats = 1, order = 0 } = req.body;
    const adminId = req.user!.userId;

    if (!title || !title.trim()) {
      res.status(400).json({ message: "Position title is required" });
      return;
    }

    const election = await db.orm.public.Election.where({ id: electionId }).first();
    if (!election) {
      res.status(404).json({ message: "Election not found" });
      return;
    }

    if (election.status !== "DRAFT") {
      res.status(400).json({ message: "Positions can only be added to DRAFT elections" });
      return;
    }

    const position = await db.orm.public.Position.create({
      electionId,
      title: title.trim(),
      seats: Number(seats) || 1,
      order: Number(order) || 0,
    });

    await logAudit({
      actorId: adminId,
      action: "POSITION_CREATED",
      entity: "Position",
      entityId: position.id,
      metadata: { electionId, title: position.title },
    });

    res.status(201).json({ message: "Position created successfully", position });
  } catch (error: any) {
    res.status(500).json({ message: "Failed to create position", error: error.message });
  }
};

export const getPositionsByElection = async (req: Request, res: Response): Promise<void> => {
  try {
    const { electionId } = req.params;
    const positions = await db.orm.public.Position.where({ electionId })
      .include("candidates")
      .all();

    res.status(200).json({ positions });
  } catch (error: any) {
    res.status(500).json({ message: "Failed to fetch positions", error: error.message });
  }
};

export const updatePosition = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { title, seats, order } = req.body;
    const adminId = req.user!.userId;

    const position = await db.orm.public.Position.where({ id }).first();
    if (!position) {
      res.status(404).json({ message: "Position not found" });
      return;
    }

    const updateData: Record<string, any> = {};
    if (title) updateData.title = title.trim();
    if (seats !== undefined) updateData.seats = Number(seats);
    if (order !== undefined) updateData.order = Number(order);

    await db.orm.public.Position.where({ id }).update(updateData);

    await logAudit({
      actorId: adminId,
      action: "POSITION_UPDATED",
      entity: "Position",
      entityId: id,
      metadata: updateData,
    });

    const updated = await db.orm.public.Position.where({ id }).first();
    res.status(200).json({ message: "Position updated successfully", position: updated });
  } catch (error: any) {
    res.status(500).json({ message: "Failed to update position", error: error.message });
  }
};

export const deletePosition = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const adminId = req.user!.userId;

    const position = await db.orm.public.Position.where({ id }).first();
    if (!position) {
      res.status(404).json({ message: "Position not found" });
      return;
    }

    await db.orm.public.Position.where({ id }).delete();

    await logAudit({
      actorId: adminId,
      action: "POSITION_DELETED",
      entity: "Position",
      entityId: id,
    });

    res.status(200).json({ message: "Position deleted successfully" });
  } catch (error: any) {
    res.status(500).json({ message: "Failed to delete position", error: error.message });
  }
};
`,
  },

  // --------------------------------------------------------------------------
  // FILE 9: src/routes/position.routes.ts (NEW FILE)
  // --------------------------------------------------------------------------
  "src/routes/position.routes.ts": {
    action: "CREATE",
    purpose: "Position route configuration.",
    code: `
import { Router } from "express";
import {
  createPosition,
  getPositionsByElection,
  updatePosition,
  deletePosition,
} from "../controllers/position.controller.ts";
import { authenticate, requireAdmin } from "../middlewares/auth.middleware.ts";

const router: Router = Router({ mergeParams: true });

router.get("/:electionId/positions", authenticate, getPositionsByElection);
router.post("/:electionId/positions", authenticate, requireAdmin, createPosition);
router.put("/positions/:id", authenticate, requireAdmin, updatePosition);
router.delete("/positions/:id", authenticate, requireAdmin, deletePosition);

export default router;
`,
  },

  // --------------------------------------------------------------------------
  // FILE 10: src/controllers/candidate.controller.ts (NEW FILE)
  // --------------------------------------------------------------------------
  "src/controllers/candidate.controller.ts": {
    action: "CREATE",
    purpose: "Manages candidates contesting for election positions.",
    code: `
import type { Request, Response } from "express";
import { db } from "../prisma/db.ts";
import { logAudit } from "../lib/audit.ts";

export const createCandidate = async (req: Request, res: Response): Promise<void> => {
  try {
    const { positionId } = req.params;
    const { fullName, manifesto, photoUrl, order = 0 } = req.body;
    const adminId = req.user!.userId;

    if (!fullName || !fullName.trim()) {
      res.status(400).json({ message: "Candidate full name is required" });
      return;
    }

    const position = await db.orm.public.Position.where({ id: positionId }).first();
    if (!position) {
      res.status(404).json({ message: "Position not found" });
      return;
    }

    const candidate = await db.orm.public.Candidate.create({
      positionId,
      fullName: fullName.trim(),
      manifesto: manifesto ? manifesto.trim() : null,
      photoUrl: photoUrl || null,
      order: Number(order) || 0,
    });

    await logAudit({
      actorId: adminId,
      action: "CANDIDATE_CREATED",
      entity: "Candidate",
      entityId: candidate.id,
      metadata: { positionId, fullName: candidate.fullName },
    });

    res.status(201).json({ message: "Candidate created successfully", candidate });
  } catch (error: any) {
    res.status(500).json({ message: "Failed to create candidate", error: error.message });
  }
};

export const getCandidatesByPosition = async (req: Request, res: Response): Promise<void> => {
  try {
    const { positionId } = req.params;
    const candidates = await db.orm.public.Candidate.where({ positionId }).all();

    res.status(200).json({ candidates });
  } catch (error: any) {
    res.status(500).json({ message: "Failed to fetch candidates", error: error.message });
  }
};

export const updateCandidate = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { fullName, manifesto, photoUrl, order } = req.body;
    const adminId = req.user!.userId;

    const candidate = await db.orm.public.Candidate.where({ id }).first();
    if (!candidate) {
      res.status(404).json({ message: "Candidate not found" });
      return;
    }

    const updateData: Record<string, any> = {};
    if (fullName) updateData.fullName = fullName.trim();
    if (manifesto !== undefined) updateData.manifesto = manifesto ? manifesto.trim() : null;
    if (photoUrl !== undefined) updateData.photoUrl = photoUrl;
    if (order !== undefined) updateData.order = Number(order);

    await db.orm.public.Candidate.where({ id }).update(updateData);

    await logAudit({
      actorId: adminId,
      action: "CANDIDATE_UPDATED",
      entity: "Candidate",
      entityId: id,
      metadata: updateData,
    });

    const updated = await db.orm.public.Candidate.where({ id }).first();
    res.status(200).json({ message: "Candidate updated successfully", candidate: updated });
  } catch (error: any) {
    res.status(500).json({ message: "Failed to update candidate", error: error.message });
  }
};

export const deleteCandidate = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const adminId = req.user!.userId;

    const candidate = await db.orm.public.Candidate.where({ id }).first();
    if (!candidate) {
      res.status(404).json({ message: "Candidate not found" });
      return;
    }

    await db.orm.public.Candidate.where({ id }).delete();

    await logAudit({
      actorId: adminId,
      action: "CANDIDATE_DELETED",
      entity: "Candidate",
      entityId: id,
    });

    res.status(200).json({ message: "Candidate deleted successfully" });
  } catch (error: any) {
    res.status(500).json({ message: "Failed to delete candidate", error: error.message });
  }
};
`,
  },

  // --------------------------------------------------------------------------
  // FILE 11: src/routes/candidate.routes.ts (NEW FILE)
  // --------------------------------------------------------------------------
  "src/routes/candidate.routes.ts": {
    action: "CREATE",
    purpose: "Candidate route configuration.",
    code: `
import { Router } from "express";
import {
  createCandidate,
  getCandidatesByPosition,
  updateCandidate,
  deleteCandidate,
} from "../controllers/candidate.controller.ts";
import { authenticate, requireAdmin } from "../middlewares/auth.middleware.ts";

const router: Router = Router({ mergeParams: true });

router.get("/:positionId/candidates", authenticate, getCandidatesByPosition);
router.post("/:positionId/candidates", authenticate, requireAdmin, createCandidate);
router.put("/candidates/:id", authenticate, requireAdmin, updateCandidate);
router.delete("/candidates/:id", authenticate, requireAdmin, deleteCandidate);

export default router;
`,
  },

  // --------------------------------------------------------------------------
  // FILE 12: src/controllers/voter-roll.controller.ts (NEW FILE)
  // --------------------------------------------------------------------------
  "src/controllers/voter-roll.controller.ts": {
    action: "CREATE",
    purpose: "Manages voter eligibility lists (VoterRoll) per election.",
    code: `
import type { Request, Response } from "express";
import { db } from "../prisma/db.ts";
import { logAudit } from "../lib/audit.ts";

export const addVotersToRoll = async (req: Request, res: Response): Promise<void> => {
  try {
    const { electionId } = req.params;
    const { userIds = [], matricNumbers = [] } = req.body;
    const adminId = req.user!.userId;

    const election = await db.orm.public.Election.where({ id: electionId }).first();
    if (!election) {
      res.status(404).json({ message: "Election not found" });
      return;
    }

    const resolvedUserIds: Set<string> = new Set(userIds);

    // Resolve user IDs from matriculation numbers if provided
    for (const matric of matricNumbers) {
      const user = await db.orm.public.User.where({ matricNo: matric.trim() }).first();
      if (user) {
        resolvedUserIds.add(user.id);
      }
    }

    let addedCount = 0;
    for (const uId of resolvedUserIds) {
      const exists = await db.orm.public.VoterRoll.where({
        electionId,
        userId: uId,
      }).first();

      if (!exists) {
        await db.orm.public.VoterRoll.create({
          electionId,
          userId: uId,
        });
        addedCount++;
      }
    }

    await logAudit({
      actorId: adminId,
      action: "VOTERS_ADDED_TO_ROLL",
      entity: "VoterRoll",
      metadata: { electionId, count: addedCount },
    });

    res.status(200).json({
      message: \`Successfully added \${addedCount} voter(s) to the roll.\`,
      totalAdded: addedCount,
    });
  } catch (error: any) {
    res.status(500).json({ message: "Failed to add voters to roll", error: error.message });
  }
};

export const getVoterRoll = async (req: Request, res: Response): Promise<void> => {
  try {
    const { electionId } = req.params;
    const roll = await db.orm.public.VoterRoll.where({ electionId })
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
  } catch (error: any) {
    res.status(500).json({ message: "Failed to fetch voter roll", error: error.message });
  }
};

export const removeVoterFromRoll = async (req: Request, res: Response): Promise<void> => {
  try {
    const { electionId, userId } = req.params;
    const adminId = req.user!.userId;

    const entry = await db.orm.public.VoterRoll.where({ electionId, userId }).first();
    if (!entry) {
      res.status(404).json({ message: "Voter is not in this election's roll." });
      return;
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
  } catch (error: any) {
    res.status(500).json({ message: "Failed to remove voter", error: error.message });
  }
};
`,
  },

  // --------------------------------------------------------------------------
  // FILE 13: src/routes/voter-roll.routes.ts (NEW FILE)
  // --------------------------------------------------------------------------
  "src/routes/voter-roll.routes.ts": {
    action: "CREATE",
    purpose: "Voter roll route configuration.",
    code: `
import { Router } from "express";
import {
  addVotersToRoll,
  getVoterRoll,
  removeVoterFromRoll,
} from "../controllers/voter-roll.controller.ts";
import { authenticate, requireAdmin } from "../middlewares/auth.middleware.ts";

const router: Router = Router({ mergeParams: true });

router.get("/:electionId/voters", authenticate, requireAdmin, getVoterRoll);
router.post("/:electionId/voters", authenticate, requireAdmin, addVotersToRoll);
router.delete("/:electionId/voters/:userId", authenticate, requireAdmin, removeVoterFromRoll);

export default router;
`,
  },

  // --------------------------------------------------------------------------
  // FILE 14: src/controllers/vote.controller.ts (NEW FILE - The Secret Ballot Core)
  // --------------------------------------------------------------------------
  "src/controllers/vote.controller.ts": {
    action: "CREATE",
    purpose: "Executes atomic secret ballot voting and receipt verification.",
    code: `
import type { Request, Response } from "express";
import crypto from "crypto";
import { db } from "../prisma/db.ts";

interface VoteChoice {
  positionId: string;
  candidateId: string | null; // null represents an intentional blank/abstain vote
}

/**
 * Casts a secret ballot inside an ACID transaction.
 *
 * Rules:
 * 1. Election status must be OPEN.
 * 2. Current time must fall between startsAt and endsAt.
 * 3. Voter must exist in VoterRoll.
 * 4. Voter must NOT have already cast a Ballot (checked via Ballot table & unique constraint).
 * 5. Position and candidate IDs must belong to the given election.
 * 6. Votes are saved separately from Ballot without userId/ballotId link to guarantee secrecy.
 */
export const castVote = async (req: Request, res: Response): Promise<void> => {
  try {
    const { electionId } = req.params;
    const { selections } = req.body as { selections: VoteChoice[] };
    const voterId = req.user!.userId;

    if (!Array.isArray(selections) || selections.length === 0) {
      res.status(400).json({ message: "Selections array is required with at least one vote." });
      return;
    }

    // 1. Fetch Election and check status & time window
    const election = await db.orm.public.Election.where({ id: electionId }).first();
    if (!election) {
      res.status(404).json({ message: "Election not found" });
      return;
    }

    if (election.status !== "OPEN") {
      res.status(400).json({ message: \`Election is not open for voting. Current status: \${election.status}\` });
      return;
    }

    const now = new Date();
    if (now < new Date(election.startsAt)) {
      res.status(400).json({ message: "Voting has not yet started for this election." });
      return;
    }
    if (now > new Date(election.endsAt)) {
      res.status(400).json({ message: "Voting has ended for this election." });
      return;
    }

    // 2. Check Voter Eligibility
    const rollEntry = await db.orm.public.VoterRoll.where({
      electionId,
      userId: voterId,
    }).first();

    if (!rollEntry) {
      res.status(403).json({ message: "You are not registered on the voter roll for this election." });
      return;
    }

    // 3. Check for previous ballot
    const existingBallot = await db.orm.public.Ballot.where({
      electionId,
      userId: voterId,
    }).first();

    if (existingBallot) {
      res.status(409).json({ message: "You have already cast your ballot in this election." });
      return;
    }

    // 4. Validate Positions and Candidates
    const electionPositions = await db.orm.public.Position.where({ electionId })
      .include("candidates")
      .all();

    const positionMap = new Map<string, any>();
    for (const p of electionPositions) {
      positionMap.set(p.id, p);
    }

    for (const sel of selections) {
      const position = positionMap.get(sel.positionId);
      if (!position) {
        res.status(400).json({ message: \`Invalid position ID: \${sel.positionId} does not belong to this election.\` });
        return;
      }

      if (sel.candidateId) {
        const candidateExists = position.candidates.some((c: any) => c.id === sel.candidateId);
        if (!candidateExists) {
          res.status(400).json({
            message: \`Invalid candidate ID: \${sel.candidateId} does not run for position \${position.title}.\`,
          });
          return;
        }
      }
    }

    // 5. Generate unique Receipt Code
    const randomHex = crypto.randomBytes(6).toString("hex").toUpperCase();
    const receiptCode = \`REC-\${electionId.slice(0, 4)}-\${randomHex}\`;

    // 6. ATOMIC TRANSACTION: Insert Ballot + Votes
    await db.transaction(async (tx) => {
      // Create Ballot (Records THAT the user voted)
      await tx.orm.public.Ballot.create({
        electionId,
        userId: voterId,
        receiptCode,
        castAt: now,
      });

      // Create Votes (Records WHAT was chosen, decoupled from voterId)
      for (const sel of selections) {
        await tx.orm.public.Vote.create({
          electionId,
          positionId: sel.positionId,
          candidateId: sel.candidateId || null,
          castAt: now,
        });
      }
    });

    res.status(201).json({
      message: "Vote cast successfully and recorded.",
      receiptCode,
      electionId,
      castAt: now,
    });
  } catch (error: any) {
    if (error.message?.includes("unique") || error.code === "23505") {
      res.status(409).json({ message: "You have already cast a ballot in this election." });
      return;
    }
    res.status(500).json({ message: "Failed to cast vote", error: error.message });
  }
};

/**
 * Public ballot receipt verification endpoint.
 * Proves that a ballot was accepted and counted without disclosing choices.
 */
export const verifyBallotReceipt = async (req: Request, res: Response): Promise<void> => {
  try {
    const { electionId, receiptCode } = req.params;

    const ballot = await db.orm.public.Ballot.where({
      electionId,
      receiptCode: receiptCode.trim(),
    }).first();

    if (!ballot) {
      res.status(404).json({
        verified: false,
        message: "Invalid receipt code. No matching ballot found for this election.",
      });
      return;
    }

    res.status(200).json({
      verified: true,
      message: "Ballot verified. Your vote is securely recorded and counted.",
      electionId: ballot.electionId,
      receiptCode: ballot.receiptCode,
      castAt: ballot.castAt,
    });
  } catch (error: any) {
    res.status(500).json({ message: "Failed to verify receipt", error: error.message });
  }
};
`,
  },

  // --------------------------------------------------------------------------
  // FILE 15: src/routes/vote.routes.ts (NEW FILE)
  // --------------------------------------------------------------------------
  "src/routes/vote.routes.ts": {
    action: "CREATE",
    purpose: "Vote casting and receipt verification routes.",
    code: `
import { Router } from "express";
import { castVote, verifyBallotReceipt } from "../controllers/vote.controller.ts";
import { authenticate } from "../middlewares/auth.middleware.ts";

const router: Router = Router({ mergeParams: true });

router.post("/:electionId/vote", authenticate, castVote);
router.get("/:electionId/verify/:receiptCode", verifyBallotReceipt);

export default router;
`,
  },

  // --------------------------------------------------------------------------
  // FILE 16: src/controllers/result.controller.ts (NEW FILE)
  // --------------------------------------------------------------------------
  "src/controllers/result.controller.ts": {
    action: "CREATE",
    purpose: "Vote aggregation, winner determination, and voter turnout metrics.",
    code: `
import type { Request, Response } from "express";
import { db } from "../prisma/db.ts";

export const getElectionResults = async (req: Request, res: Response): Promise<void> => {
  try {
    const { electionId } = req.params;
    const user = req.user;

    const election = await db.orm.public.Election.where({ id: electionId }).first();
    if (!election) {
      res.status(404).json({ message: "Election not found" });
      return;
    }

    // Access control: Results only available if PUBLISHED, or if requester is ADMIN
    const isAdmin = user?.role === "ADMIN";
    if (election.status !== "PUBLISHED" && !isAdmin) {
      res.status(403).json({
        message: "Election results have not been published yet.",
        electionStatus: election.status,
      });
      return;
    }

    // Fetch all positions & candidates
    const positions = await db.orm.public.Position.where({ electionId })
      .include("candidates")
      .all();

    // Fetch all votes for this election
    const votes = await db.orm.public.Vote.where({ electionId }).all();

    // Fetch turnout stats
    const totalBallots = (await db.orm.public.Ballot.where({ electionId }).all()).length;
    const totalRoll = (await db.orm.public.VoterRoll.where({ electionId }).all()).length;
    const turnoutPercentage = totalRoll > 0 ? ((totalBallots / totalRoll) * 100).toFixed(2) : "0.00";

    // Tally votes per position & candidate
    const resultsByPosition = positions.map((pos: any) => {
      const positionVotes = votes.filter((v: any) => v.positionId === pos.id);
      const totalPositionVotes = positionVotes.length;

      let blankVotes = 0;
      const candidateTallyMap = new Map<string, number>();

      for (const c of pos.candidates) {
        candidateTallyMap.set(c.id, 0);
      }

      for (const vote of positionVotes) {
        if (!vote.candidateId) {
          blankVotes++;
        } else {
          const current = candidateTallyMap.get(vote.candidateId) || 0;
          candidateTallyMap.set(vote.candidateId, current + 1);
        }
      }

      const candidateResults = pos.candidates
        .map((c: any) => {
          const voteCount = candidateTallyMap.get(c.id) || 0;
          const percentage = totalPositionVotes > 0 ? ((voteCount / totalPositionVotes) * 100).toFixed(2) : "0.00";
          return {
            id: c.id,
            fullName: c.fullName,
            photoUrl: c.photoUrl,
            voteCount,
            percentage,
          };
        })
        .sort((a: any, b: any) => b.voteCount - a.voteCount);

      // Determine winners based on available seats
      const winners = candidateResults.slice(0, pos.seats);

      return {
        positionId: pos.id,
        title: pos.title,
        seats: pos.seats,
        totalVotes: totalPositionVotes,
        blankVotes,
        candidates: candidateResults,
        winners,
      };
    });

    res.status(200).json({
      election: {
        id: election.id,
        title: election.title,
        status: election.status,
        publishedAt: election.publishedAt,
      },
      turnout: {
        registeredVoters: totalRoll,
        ballotsCast: totalBallots,
        turnoutPercentage: \`\${turnoutPercentage}%\`,
      },
      results: resultsByPosition,
    });
  } catch (error: any) {
    res.status(500).json({ message: "Failed to generate election results", error: error.message });
  }
};
`,
  },

  // --------------------------------------------------------------------------
  // FILE 17: src/routes/result.routes.ts (NEW FILE)
  // --------------------------------------------------------------------------
  "src/routes/result.routes.ts": {
    action: "CREATE",
    purpose: "Election result query routes.",
    code: `
import { Router } from "express";
import { getElectionResults } from "../controllers/result.controller.ts";
import { authenticate } from "../middlewares/auth.middleware.ts";

const router: Router = Router({ mergeParams: true });

router.get("/:electionId/results", authenticate, getElectionResults);

export default router;
`,
  },

  // --------------------------------------------------------------------------
  // FILE 18: src/middlewares/error.middleware.ts (NEW FILE)
  // --------------------------------------------------------------------------
  "src/middlewares/error.middleware.ts": {
    action: "CREATE",
    purpose: "Global error and 404 handler for Express.",
    code: `
import type { Request, Response, NextFunction } from "express";

export const notFoundHandler = (req: Request, res: Response): void => {
  res.status(404).json({
    message: \`Route not found: \${req.method} \${req.originalUrl}\`,
  });
};

export const globalErrorHandler = (
  err: any,
  _req: Request,
  res: Response,
  _next: NextFunction
): void => {
  console.error("Unhandled Error:", err);
  const status = err.status || err.statusCode || 500;
  res.status(status).json({
    message: err.message || "An unexpected error occurred.",
    ...(process.env.NODE_ENV !== "production" && { stack: err.stack }),
  });
};
`,
  },

  // --------------------------------------------------------------------------
  // FILE 19: src/app.ts (Integration & Routing Assembly)
  // --------------------------------------------------------------------------
  "src/app.ts": {
    action: "MODIFY",
    purpose: "Main Express application mounting all routers and middlewares.",
    code: `
import express, { type Application } from "express";
import { config } from "dotenv";

import authRoutes from "./routes/auth.routes.ts";
import electionRoutes from "./routes/election.routes.ts";
import positionRoutes from "./routes/position.routes.ts";
import candidateRoutes from "./routes/candidate.routes.ts";
import voterRollRoutes from "./routes/voter-roll.routes.ts";
import voteRoutes from "./routes/vote.routes.ts";
import resultRoutes from "./routes/result.routes.ts";
import { notFoundHandler, globalErrorHandler } from "./middlewares/error.middleware.ts";

config();
const app: Application = express();
const PORT = process.env.PORT || 8000;

// Core Middlewares
app.use(express.json());

// API Route Mounts (Versioned under /api/v1)
app.use("/api/v1/auth", authRoutes);
app.use("/api/v1/elections", electionRoutes);
app.use("/api/v1/elections", positionRoutes);
app.use("/api/v1/elections", candidateRoutes);
app.use("/api/v1/elections", voterRollRoutes);
app.use("/api/v1/elections", voteRoutes);
app.use("/api/v1/elections", resultRoutes);

// Health Check
app.get("/health", (_req, res) => {
  res.status(200).json({ status: "healthy", timestamp: new Date() });
});

// Error handling
app.use(notFoundHandler);
app.use(globalErrorHandler);

app.listen(PORT, () => {
  console.log(\`Voting API Server running on port \${PORT}\`);
});

export default app;
`,
  },
};

