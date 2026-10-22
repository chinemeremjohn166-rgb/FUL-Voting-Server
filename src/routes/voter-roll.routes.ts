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
