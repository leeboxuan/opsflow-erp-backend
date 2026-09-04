/** Collapse Rd/Road, punctuation, and case so place name vs street do not duplicate. */
export function normalizePlacesAddressCompareKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[.,/#]/g, " ")
    .replace(/\b(road)\b/g, "rd")
    .replace(/\b(street)\b/g, "st")
    .replace(/\b(avenue)\b/g, "ave")
    .replace(/\b(boulevard)\b/g, "blvd")
    .replace(/\b(drive)\b/g, "dr")
    .replace(/\b(lane)\b/g, "ln")
    .replace(/\b(place)\b/g, "pl")
    .replace(/\s+/g, " ")
    .trim();
}

/** Compose Places address line 1 without duplicating place name and street. */
export function buildPlacesAddressLine1(parts: {
  name: string;
  block: string | null;
  route: string | null;
}): string {
  const street = [parts.block, parts.route].filter(Boolean).join(" ").trim();
  if (!parts.name) return street;
  if (!street) return parts.name;
  const nameKey = normalizePlacesAddressCompareKey(parts.name);
  const streetKey = normalizePlacesAddressCompareKey(street);
  if (!nameKey || nameKey === streetKey) return street || parts.name;
  if (nameKey.includes(streetKey) || streetKey.includes(nameKey)) {
    return street.length >= parts.name.length ? street : parts.name;
  }
  return `${parts.name}, ${street}`;
}

/** Unit / subpremise only for address line 2. */
export function buildPlacesAddressLine2FromSubpremise(
  subpremise: string | null | undefined,
): string {
  const trimmed = String(subpremise ?? "").trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("#")) return trimmed;
  if (/^\d{1,2}\s*-\s*\d{2,4}$/.test(trimmed)) return `#${trimmed.replace(/\s+/g, "")}`;
  return trimmed;
}
