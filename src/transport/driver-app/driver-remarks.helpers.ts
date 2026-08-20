/**
 * Driver → Operations remarks helpers (distinct from Trip instructions / Job notes).
 * Timestamps and history come from audit metadata — no schema migration.
 */

export const DRIVER_REMARKS_NOTIFICATION_KIND = "DRIVER_REMARKS_UPDATED" as const;

export function normalizeDriverRemarksText(
  value: string | null | undefined,
): string | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function driverRemarksChanged(
  previous: string | null | undefined,
  next: string | null | undefined,
): boolean {
  return normalizeDriverRemarksText(previous) !== normalizeDriverRemarksText(next);
}

export function buildDriverRemarksAuditMetadata(input: {
  jobId: string;
  previousDriverRemarks: string | null;
  driverRemarks: string | null;
  changedFields: string[];
  containers?: Array<{
    itemId: string;
    containerNumber?: string | null;
    sealNumber?: string | null;
  }>;
  updatedAtIso: string;
  actorUserId: string;
}): Record<string, unknown> {
  const remarksTouched = input.changedFields.includes("driverRemarks");
  return {
    jobId: input.jobId,
    changedFields: [...new Set(input.changedFields)],
    containers: input.containers ?? [],
    previousDriverRemarks: input.previousDriverRemarks,
    driverRemarks: input.driverRemarks,
    actorUserId: input.actorUserId,
    ...(remarksTouched
      ? { driverRemarksUpdatedAt: input.updatedAtIso }
      : {}),
  };
}

/** Activity tab label — each edit is its own historical row. */
export function labelForOperationalDetailsActivity(
  metadata: Record<string, unknown> | null | undefined,
): string {
  const fields = Array.isArray(metadata?.changedFields)
    ? (metadata!.changedFields as unknown[]).map((f) => String(f))
    : [];
  const remarksTouched = fields.includes("driverRemarks");
  const containerTouched = fields.some(
    (f) => f === "containerNumber" || f === "sealNumber",
  );
  if (remarksTouched && !containerTouched) return "Driver remarks updated";
  if (remarksTouched && containerTouched) {
    return "Driver remarks and container details updated";
  }
  if (containerTouched) return "Container details updated";
  return "Operational details updated";
}

export function opsCopyForDriverRemarksNotification(ctx: string): {
  title: string;
  description: string;
} {
  return {
    title: "Driver remark updated",
    description: `${ctx} — driver sent a remark to Operations.`,
  };
}

export function auditLogHasDriverRemarksChange(
  metadata: Record<string, unknown> | null | undefined,
): boolean {
  const fields = Array.isArray(metadata?.changedFields)
    ? (metadata!.changedFields as unknown[])
    : [];
  return fields.some((f) => String(f) === "driverRemarks");
}
