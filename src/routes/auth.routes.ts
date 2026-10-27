import { Router } from "express";
import {
  registerUser,
  loginUser,
  getCurrentUser,
  logoutUser,
  verifyEmail,
  resendVerification,
} from "../controllers/auth.controller.ts";
import { authenticate } from "../middlewares/auth.middleware.ts";

const router: Router = Router();

router.post("/register", registerUser);
router.post("/login", loginUser);
router.post("/verify-email", verifyEmail);
router.post("/resend-verification", resendVerification);
router.get("/me", authenticate, getCurrentUser);
router.post("/logout", authenticate, logoutUser);

export default router;
