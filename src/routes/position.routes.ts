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
