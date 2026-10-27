import { db } from "../prisma/db.ts";

export interface AuditParams {
  actorId: string;
  action: string;
  entity: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
}

/** Anything exposing the ORM surface: the root `db` or a transaction `tx`. */
export type OrmContext = Pick<typeof db, "orm">;

/**
 * Writes an audit entry. Pass the transaction context so the audit row commits
 * (or rolls back) together with the change it describes. Failures propagate:
 * a state change without its audit record must not silently succeed.
 */
export const logAudit = async (
  { actorId, action, entity, entityId, metadata }: AuditParams,
  ctx: OrmContext = db
): Promise<void> => {
  await ctx.orm.public.AuditLog.create({
    actorId,
    action,
    entity,
    entityId: entityId ?? null,
    // Jsonb column: pass the object itself. JSON.stringify would store a JSON *string*.
    metadata: (metadata ?? null) as any,
  });
};
