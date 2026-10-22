import { config } from "./config.ts";
import app from "./app.ts";

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

// Graceful shutdown handling
process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down gracefully...");
  server.close(() => {
    console.log("Server closed.");
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  console.log("SIGINT received, shutting down gracefully...");
  server.close(() => {
    console.log("Server closed.");
    process.exit(0);
  });
});
