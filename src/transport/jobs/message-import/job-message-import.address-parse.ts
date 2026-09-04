export type ParsedSingaporeAddress = {
  addressLine1: string | null;
  postalCode: string | null;
  addressLine2: string | null;
  unitLevel: string | null;
  unitNumber: string | null;
};

function parseHashUnit(token: string): { unitLevel: string; unitNumber: string } | null {
  const m = /^#\s*(\d{1,2})\s*-\s*(\d{2,4})$/i.exec(token.trim());
  if (!m) return null;
  return { unitLevel: m[1], unitNumber: m[2] };
}

function buildAddressLine2(unitLevel: string | null, unitNumber: string | null): string | null {
  if (unitLevel && unitNumber) return `#${unitLevel}-${unitNumber}`;
  if (unitLevel && !unitNumber) return `#${unitLevel}`;
  return null;
}

/**
 * Extract Singapore postal code, unit number, and base address line from free text.
 * Removes extracted postal and unit tokens from the displayed address line.
 */
export function parseSingaporeAddress(raw: string | null | undefined): ParsedSingaporeAddress {
  let text = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!text) {
    return {
      addressLine1: null,
      postalCode: null,
      addressLine2: null,
      unitLevel: null,
      unitNumber: null,
    };
  }

  let unitLevel: string | null = null;
  let unitNumber: string | null = null;

  // Prefer comma-delimited units; also accept a trailing hash unit without a comma
  // (e.g. "31 JURONG PORT ROAD #07-20"). Never treat "Sector 2" / street numbers as units.
  const trailingUnitPatterns = [
    /,\s*(#\s*\d{1,2}\s*-\s*\d{2,4})\s*$/i,
    /\s+(#\s*\d{1,2}\s*-\s*\d{2,4})\s*$/i,
    /,\s*Unit\s+(\d{1,2})\s*-\s*(\d{2,4})\s*$/i,
    /,\s*(\d{2})\s*-\s*(\d{2,4})\s*$/,
    /,\s*Level\s+(\d{1,2})\s*$/i,
  ];

  for (const pattern of trailingUnitPatterns) {
    const match = pattern.exec(text);
    if (!match) continue;
    if (match[1]?.startsWith("#")) {
      const parsed = parseHashUnit(match[1]);
      if (parsed) {
        unitLevel = parsed.unitLevel;
        unitNumber = parsed.unitNumber;
        text = text.slice(0, match.index).trim();
        break;
      }
    }
    if (pattern.source.includes("Unit")) {
      unitLevel = match[1];
      unitNumber = match[2];
      text = text.slice(0, match.index).trim();
      break;
    }
    if (pattern.source.includes("Level")) {
      unitLevel = match[1];
      text = text.slice(0, match.index).trim();
      break;
    }
    if (/^\d{2}$/.test(match[1]) && /^\d{2,4}$/.test(match[2])) {
      unitLevel = match[1];
      unitNumber = match[2];
      text = text.slice(0, match.index).trim();
      break;
    }
  }

  let postalCode: string | null = null;
  const postalPatterns = [
    /,\s*Singapore\s+(\d{6})\s*$/i,
    /,\s*S(\d{6})\s*$/i,
    /,\s*\((\d{6})\)\s*$/,
    /,\s*(\d{6})\s*$/,
  ];
  for (const pattern of postalPatterns) {
    const match = pattern.exec(text);
    if (!match) continue;
    postalCode = match[1];
    text = text.slice(0, match.index).trim();
    break;
  }

  text = text.replace(/,\s*Singapore\s*$/i, "").trim();

  return {
    addressLine1: text || null,
    postalCode,
    addressLine2: buildAddressLine2(unitLevel, unitNumber),
    unitLevel,
    unitNumber,
  };
}

/** Apply postal/unit parsing when structured fields are still empty. */
export function enrichAddressFields(input: {
  address1: string | null;
  address2: string | null;
  postal: string | null;
}): {
  address1: string | null;
  address2: string | null;
  postal: string | null;
} {
  if (input.postal?.trim() && input.address2?.trim()) {
    return input;
  }
  const parsed = parseSingaporeAddress(input.address1);
  if (!parsed.addressLine1) return input;
  return {
    address1: parsed.addressLine1,
    postal: input.postal ?? parsed.postalCode,
    address2: input.address2 ?? parsed.addressLine2,
  };
}
