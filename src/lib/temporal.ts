/**
 * Prisma 8 reads/writes DateTime columns as Temporal values. Node < 26.8.2
 * (this project runs Node 24) has no global Temporal, so install the polyfill
 * before any query runs. Import this module before the db client.
 */
import "temporal-polyfill/global";
import { Temporal } from "temporal-polyfill";

export { Temporal };

export const now = (): Temporal.Instant => Temporal.Now.instant();

/**
 * Normalises whatever a DateTime column came back as - a Temporal.Instant, a
 * Date, an ISO string or an epoch number - into epoch milliseconds.
 */
export const toEpochMs = (value: unknown): number | undefined => {
  if (value === null || value === undefined) return undefined;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = new Date(value).getTime();
    return Number.isNaN(parsed) ? undefined : parsed;
  }
  const instant = value as { epochMilliseconds?: number };
  if (typeof instant.epochMilliseconds === "number") return instant.epochMilliseconds;
  return undefined;
};
