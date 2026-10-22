import { Router } from "express";
import { getElectionResults } from "../controllers/result.controller.ts";
import { authenticate } from "../middlewares/auth.middleware.ts";

const router: Router = Router({ mergeParams: true });

router.get("/:electionId/results", authenticate, getElectionResults);

export default router;
