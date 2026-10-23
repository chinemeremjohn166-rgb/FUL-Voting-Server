import express, { type Application } from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { config } from "./config.ts";

import authRoutes from "./routes/auth.routes.ts";
import electionRoutes from "./routes/election.routes.ts";
import positionRoutes from "./routes/position.routes.ts";
import candidateRoutes from "./routes/candidate.routes.ts";
import voterRollRoutes from "./routes/voter-roll.routes.ts";
import voteRoutes from "./routes/vote.routes.ts";
import resultRoutes from "./routes/result.routes.ts";
import {
  notFoundHandler,
  globalErrorHandler,
} from "./middlewares/error.middleware.ts";
import { db } from "./prisma/db.ts";
import cors from "cors";

const app: Application = express();

// allow cross-origin requests (Fix M10)
app.use(
  cors({
    origin: ["http://localhost:3000", "https://ful-voting.vercel.app"],
    credentials: true,
  }),
);

// Security headers (Fix M10)
app.use(helmet());

// Body size limit to prevent request body DOS (Fix M10)
app.use(express.json({ limit: "50kb" }));

// Rate limiters (Fix H7) - bypassed in test environments
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 20, // 20 attempts per IP
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => config.isTest,
  message: {
    message:
      "Too many authentication attempts. Please try again after 15 minutes.",
  },
});

const verifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => config.isTest,
  message: {
    message: "Too many receipt verification requests. Please try again later.",
  },
});

// Route Mounts (Versioned under /api/v1)
app.use("/api/v1/auth/login", authLimiter);
app.use("/api/v1/auth/register", authLimiter);
app.use("/api/v1/auth", authRoutes);

app.use("/api/v1/elections", electionRoutes);
app.use("/api/v1/elections", positionRoutes);
app.use("/api/v1/elections", candidateRoutes);
app.use("/api/v1/elections", voterRollRoutes);

// Apply verify rate limiter to public verification endpoint
app.use("/api/v1/elections/:electionId/verify", verifyLimiter);
app.use("/api/v1/elections", voteRoutes);
app.use("/api/v1/elections", resultRoutes);

// Enhanced Health Check: verifies database connectivity
app.get("/health", async (_req, res) => {
  let dbStatus = "connected";
  try {
    // Quick test query to ensure database runtime is alive
    await db.orm.public.User.where({ email: "health-probe@internal" }).first();
  } catch {
    dbStatus = "disconnected";
  }

  const isHealthy = dbStatus === "connected";
  res.status(isHealthy ? 200 : 503).json({
    status: isHealthy ? "healthy" : "degraded",
    database: dbStatus,
    timestamp: new Date().toISOString(),
  });
});

// Error handling
app.use(notFoundHandler);
app.use(globalErrorHandler);

export default app;
