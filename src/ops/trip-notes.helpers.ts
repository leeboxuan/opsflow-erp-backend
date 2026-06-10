export function normalizeOptionalNotes(
  value: string | null | undefined,
): string | null {
  if (value === undefined || value === null) return null;
  const trimmed = String(value).trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function resolveTripNotesResponseFields(
  trip: { notes?: string | null } | null | undefined,
  job?: { notes?: string | null } | null,
): {
  notes: string | null;
  jobNotes: string | null;
  tripInstruction: string | null;
} {
  const notes = normalizeOptionalNotes(trip?.notes ?? null);
  const jobNotes = normalizeOptionalNotes(job?.notes ?? null);
  return {
    notes,
    jobNotes,
    tripInstruction: jobNotes,
  };
}
