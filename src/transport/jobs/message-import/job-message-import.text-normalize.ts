const ACRONYMS = new Set([
  "PSA",
  "CFS",
  "CY",
  "POD",
  "LCL",
  "FCL",
  "PPZ",
  "DB",
  "WHSE",
  "HQ",
  "PIC",
  "ETA",
  "ETD",
  "BL",
  "DO",
  "GST",
  "SOP",
  "IMO",
]);

const ISO_CONTAINER_RE = /^[A-Z]{4}\d{7}$/i;
const POSTAL_RE = /^\d{6}$/;

function lettersOnly(value: string): string {
  return value.replace(/[^A-Za-z]/g, "");
}

function isMostlyUppercasePhrase(value: string): boolean {
  const letters = lettersOnly(value);
  if (letters.length < 3) return false;
  const upper = letters.replace(/[^A-Z]/g, "").length;
  return upper / letters.length >= 0.85;
}

function normalizeToken(token: string): string {
  const core = token.replace(/[^A-Za-z0-9]/g, "");
  if (!core) return token;
  if (ISO_CONTAINER_RE.test(core)) {
    return token.replace(core, core.toUpperCase());
  }
  if (POSTAL_RE.test(core)) return token;
  if (ACRONYMS.has(core.toUpperCase())) {
    return token.replace(new RegExp(core, "i"), core.toUpperCase());
  }
  // Keep identifiers that are already uppercase (ONE, HANNOVER, vehicle numbers).
  if (/^[A-Z0-9]{2,}$/.test(core)) return token;
  if (/^[A-Za-z]{1,3}\d{1,4}[A-Za-z]$/.test(core)) {
    return token.replace(core, core.toUpperCase());
  }
  if (/^[A-Za-z]$/.test(core)) return token.toUpperCase();
  const titled = core.charAt(0).toUpperCase() + core.slice(1).toLowerCase();
  return token.replace(core, titled);
}

function looksLikeFormattedAddress(value: string): boolean {
  return value.includes(",") || /\d{5,}/.test(value);
}

function normalizePhrase(value: string | null | undefined, kind: "name" | "company" | "location"): string | null {
  if (value == null) return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  if (isMostlyUppercasePhrase(trimmed)) return trimmed;
  if (kind === "location" && ACRONYMS.has(trimmed.toUpperCase())) return trimmed.toUpperCase();
  if (kind === "location" && looksLikeFormattedAddress(trimmed)) {
    return trimmed
      .split(" ")
      .map((token) => {
        const core = token.replace(/[^A-Za-z0-9]/g, "");
        if (ACRONYMS.has(core.toUpperCase())) {
          return token.replace(new RegExp(core, "i"), core.toUpperCase());
        }
        return token;
      })
      .join(" ");
  }
  return trimmed.split(" ").map(normalizeToken).join(" ");
}

export function normalizePersonName(value: string | null | undefined): string | null {
  return normalizePhrase(value, "name");
}

export function normalizeCompanyName(value: string | null | undefined): string | null {
  return normalizePhrase(value, "company");
}

export function normalizeLocationLabel(value: string | null | undefined): string | null {
  return normalizePhrase(value, "location");
}

export function normalizeNotes(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.replace(/\s+/g, " ").trim();
  if (!trimmed) return null;
  return trimmed
    .replace(/\b[A-Za-z]{4}\d{7}\b/g, (m) => m.toUpperCase())
    .replace(/\b(psa|cfs|cy|pod|lcl|fcl|ppz|whse)\b/gi, (m) => m.toUpperCase());
}

export function normalizeIdentifier(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.replace(/\s+/g, "").trim();
  if (!trimmed) return null;
  return trimmed.toUpperCase();
}
