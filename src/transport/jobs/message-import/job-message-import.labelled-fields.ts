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
