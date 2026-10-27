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
