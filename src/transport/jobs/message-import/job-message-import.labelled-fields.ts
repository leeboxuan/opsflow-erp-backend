const INSTRUCTION_LABEL_RE =
  /^(?:Instruction|Instructions|Note|Notes)\s*:\s*(.*)$/i;

/** Whether a substring looks like operational timing rather than a location name. */
export function looksLikeOperationalTimingExpression(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  const lower = t.toLowerCase();
  if (/\btomorrow\b|\btoday\b/.test(lower)) return true;
  if (/\d{1,2}\/\d{1,2}(?:\/\d{2,4})?/.test(t)) return true;
  if (/\bbefore\b|\bbetween\b|\bafter\b/.test(lower)) return true;
  if (/@\s*\d/.test(t)) return true;
  if (/\d{1,2}(:\d{2})?\s*(am|pm)\b/i.test(t)) return true;
  if (/\b\d{3,4}\s*-\s*\d{3,4}\b/.test(t)) return true;
  if (/\d{1,2}\/\d{1,2}\s+\d{3,4}\b/.test(t)) return true;
  return false;
}

/**
 * Separates a labelled Pickup/Delivery value into location and trailing timing text.
 * Preserves timing separately; does not discard it.
 */
export function splitLocationFromTiming(rawText: string | null | undefined): {
  location: string | null;
  timingText: string | null;
} {
  const raw = (rawText ?? "").replace(/\s+/g, " ").trim();
  if (!raw) return { location: null, timingText: null };

  const commaMatch = /^(.+?),\s*(.+)$/.exec(raw);
  if (commaMatch) {
    const location = commaMatch[1].trim();
    const timing = commaMatch[2].trim();
    if (
      looksLikeOperationalTimingExpression(timing) &&
      !looksLikeOperationalTimingExpression(location)
    ) {
      return { location, timingText: timing };
    }
  }

  const spaceMatch = /^([A-Za-z][A-Za-z0-9-]{0,40})\s+(.+)$/.exec(raw);
  if (spaceMatch) {
    const location = spaceMatch[1].trim();
    const timing = spaceMatch[2].trim();
    if (looksLikeOperationalTimingExpression(timing)) {
      return { location, timingText: timing };
    }
  }

  return { location: raw, timingText: null };
}

/** Extract labelled instruction/note lines from multiline source text. */
export function extractLabelledInstructions(text: string | null | undefined): string[] {
  if (!text?.trim()) return [];
  const instructions: string[] = [];
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const m = INSTRUCTION_LABEL_RE.exec(line.trim());
    if (!m) continue;
    const content = m[1].trim();
    if (!content) continue;
    const key = content.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    instructions.push(content);
  }
  return instructions;
}

/** Merge instruction arrays in order, skipping duplicates (case-insensitive). */
export function mergeInstructions(
  ...groups: Array<string[] | null | undefined>
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const item of group ?? []) {
      const trimmed = item.trim();
      if (!trimmed) continue;
      const key = trimmed.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(trimmed);
    }
  }
  return out;
}

/** True when an address string still embeds a date/time expression. */
export function addressContainsTimingExpression(address: string | null | undefined): boolean {
  if (!address?.trim()) return false;
  return looksLikeOperationalTimingExpression(address);
}

const REQUESTED_PICKUP_RE = /^Requested\s+pickup\s*:\s*(.+)$/i;
const REQUESTED_DELIVERY_RE = /^Requested\s+delivery\s*:\s*(.+)$/i;

/** Extract labelled requested pickup/delivery timing lines from source text. */
export function extractLabelledTiming(text: string | null | undefined): {
  pickupTimingText: string | null;
  deliveryTimingText: string | null;
} {
  let pickupTimingText: string | null = null;
  let deliveryTimingText: string | null = null;
  if (!text?.trim()) {
    return { pickupTimingText, deliveryTimingText };
  }
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    const pickupMatch = REQUESTED_PICKUP_RE.exec(trimmed);
    if (pickupMatch) {
      pickupTimingText = pickupMatch[1].trim();
      continue;
    }
    const deliveryMatch = REQUESTED_DELIVERY_RE.exec(trimmed);
    if (deliveryMatch) {
      deliveryTimingText = deliveryMatch[1].trim();
    }
  }
  return { pickupTimingText, deliveryTimingText };
}

/** Infer EMPTY/LOADED collection type from a source fragment. */
export function inferCollectionTypeFromFragment(
  sourceFragment: string | null | undefined,
): "EMPTY" | "LOADED" | null {
  const text = (sourceFragment ?? "").toLowerCase();
  if (/\bempty\s+collection\b/.test(text)) return "EMPTY";
  if (/\bloaded\s+collection\b/.test(text)) return "LOADED";
  return null;
}

const CARGO_ITEM_LINE_RE =
  /^([A-Za-z0-9][A-Za-z0-9._-]*)\s*\|\s*([A-Za-z0-9][A-Za-z0-9._-]*)\s*\|\s*(\d+)\s*$/;

/** Parse general-cargo item lines (`code | seal | qty`) from a source fragment. */
export function extractCargoItemsFromFragment(sourceFragment: string | null | undefined): Array<{
  referenceNumber: string;
  sealNumber: string;
  quantity: number;
}> {
  if (!sourceFragment?.trim()) return [];
  const items: Array<{ referenceNumber: string; sealNumber: string; quantity: number }> = [];
  let inItemsSection = false;
  for (const line of sourceFragment.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (/^Items\s*:/i.test(trimmed)) {
      inItemsSection = true;
      continue;
    }
    if (!inItemsSection) continue;
    if (!trimmed) break;
    if (/^[A-Za-z]+:/.test(trimmed)) break;
    const match = CARGO_ITEM_LINE_RE.exec(trimmed);
    if (!match) continue;
    items.push({
      referenceNumber: match[1].trim(),
      sealNumber: match[2].trim(),
      quantity: Number(match[3]),
    });
  }
  return items;
}
