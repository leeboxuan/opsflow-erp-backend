import { BadRequestException } from "@nestjs/common";

export type ChassisOwnershipInput = {
  isBorrowed?: boolean | null;
  borrowedFromCompany?: string | null;
};

export type ChassisOwnershipNormalized = {
  isBorrowed: boolean;
  borrowedFromCompany: string | null;
};

/**
 * Normalize chassis ownership.
 * - Company-owned: isBorrowed=false and borrowedFromCompany=null
 * - Borrowed: isBorrowed=true and non-empty trimmed company name required
 */
export function normalizeChassisOwnership(
  input: ChassisOwnershipInput,
  options?: { requireExplicitBorrowed?: boolean },
): ChassisOwnershipNormalized {
  const isBorrowed = Boolean(input.isBorrowed);
  if (!isBorrowed) {
    return { isBorrowed: false, borrowedFromCompany: null };
  }

  const company = String(input.borrowedFromCompany ?? "")
    .trim()
    .replace(/\s+/g, " ");
  if (!company) {
    throw new BadRequestException(
      "borrowedFromCompany is required when chassis is borrowed from another company",
    );
  }
  if (options?.requireExplicitBorrowed && input.isBorrowed !== true) {
    throw new BadRequestException("isBorrowed must be true when borrowedFromCompany is set");
  }
  return { isBorrowed: true, borrowedFromCompany: company };
}

export function resolveChassisOwnershipPatch(
  existing: ChassisOwnershipNormalized,
  patch: ChassisOwnershipInput,
): ChassisOwnershipNormalized {
  const nextBorrowed =
    patch.isBorrowed !== undefined && patch.isBorrowed !== null
      ? Boolean(patch.isBorrowed)
      : existing.isBorrowed;

  if (!nextBorrowed) {
    return { isBorrowed: false, borrowedFromCompany: null };
  }

  const companySource =
    patch.borrowedFromCompany !== undefined
      ? patch.borrowedFromCompany
      : existing.borrowedFromCompany;

  return normalizeChassisOwnership({
    isBorrowed: true,
    borrowedFromCompany: companySource,
  });
}

export function chassisOwnershipLabel(row: ChassisOwnershipNormalized): string {
  if (!row.isBorrowed) return "Company-owned";
  return `Borrowed · ${row.borrowedFromCompany ?? "Unknown"}`;
}
