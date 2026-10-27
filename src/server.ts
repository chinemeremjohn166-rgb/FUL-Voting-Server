import { config } from "./config.ts";
import app from "./app.ts";
import { db } from "./prisma/db.ts";

const PORT = config.port;

const server = app.listen(PORT, () => {
  console.log(`Voting API Server running on port ${PORT} [env=${config.nodeEnv}]`);
});

// An error that escapes the request pipeline would end this process and take
// every in-flight request with it. Logging it instead keeps the server answering
// while the bug behind it is found.
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled promise rejection:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("Uncaught exception:", error);
});

const shutdown = (signal: string) => {
  console.log(`${signal} received, shutting down gracefully...`);
  server.close(async () => {
    try {
      await db.close();
    } catch {
      // ignore close errors during shutdown
    }
    console.log("Server closed.");
    process.exit(0);
  });
};

// Graceful shutdown handling
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
