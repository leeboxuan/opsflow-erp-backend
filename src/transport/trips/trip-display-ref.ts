type BuildTripDisplayRefInput = {
  jobInternalRef?: string | null;
  tripSequence?: number | null;
  jobSequence?: number | null;
  tripId?: string | null;
};

function normalizeJobInternalRef(jobInternalRef?: string | null): string | null {
  const raw = String(jobInternalRef ?? "").trim();
  if (!raw) return null;
  const parts = raw.split("-");
  if (parts.length !== 5) return raw;
  const [prefix, year, month, number, type] = parts;
  const isYear = /^\d{4}$/.test(year);
  const isMonth = /^\d{2}$/.test(month);
  const hasPrefix = prefix.length > 0;
  const hasNumber = number.length > 0;
  const hasType = type.length > 0;
  if (isYear && isMonth && hasPrefix && hasNumber && hasType) {
    return `${prefix}-${number}-${type}`;
  }
  return raw;
}

function resolveSequence(tripSequence?: number | null, jobSequence?: number | null): number | null {
  const seq = tripSequence ?? jobSequence ?? null;
  if (!Number.isFinite(seq) || seq == null) return null;
  const normalized = Math.floor(Number(seq));
  return normalized > 0 ? normalized : null;
}

function tripSuffixFromId(tripId?: string | null): string {
  const raw = String(tripId ?? "").trim();
  if (!raw) return "UNKNOWN";
  return raw.slice(-6).toUpperCase();
}

export function buildTripDisplayRef(input: BuildTripDisplayRefInput): string {
  const base = normalizeJobInternalRef(input.jobInternalRef);
  const sequence = resolveSequence(input.tripSequence, input.jobSequence);
  if (sequence != null) {
    const padded = String(sequence).padStart(2, "0");
    if (base) return `${base}-T${padded}`;
    return `TRIP-T${padded}`;
  }
  const suffix = tripSuffixFromId(input.tripId);
  if (base) return `${base}-T-${suffix}`;
  return `TRIP-${suffix}`;
}
