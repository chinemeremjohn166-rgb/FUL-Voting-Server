import { Router } from "express";
import { castVote, verifyBallotReceipt } from "../controllers/vote.controller.ts";
import { authenticate } from "../middlewares/auth.middleware.ts";

const router: Router = Router({ mergeParams: true });

router.post("/:electionId/vote", authenticate, castVote);
router.get("/:electionId/verify/:receiptCode", verifyBallotReceipt);

export default router;
