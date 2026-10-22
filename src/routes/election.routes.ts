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
