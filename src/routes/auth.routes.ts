import { Router } from "express";
import { registerUser, loginUser, getCurrentUser, logoutUser } from "../controllers/auth.controller.ts";
import { authenticate } from "../middlewares/auth.middleware.ts";

const router: Router = Router();

router.post("/register", registerUser);
router.post("/login", loginUser);
router.get("/me", authenticate, getCurrentUser);
router.post("/logout", authenticate, logoutUser);

export default router;
