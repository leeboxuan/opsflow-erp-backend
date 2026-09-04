import { LogisticsLocationType, type PrismaClient } from "@prisma/client";

export type ResolvedReturningDepotMaster = {
  code: string;
  addressLine1: string;
  addressLine2: string | null;
  postalCode: string | null;
  placeId: string | null;
  lat: number | null;
  lng: number | null;
  /** Present when resolved from MasterLogisticsLocation; null for Portnet Singapore depots. */
  logisticsLocationId: string | null;
};

type PrismaDepotLookup = {
  masterSingaporeDepot: Pick<PrismaClient["masterSingaporeDepot"], "findUnique">;
  masterLogisticsLocation: Pick<PrismaClient["masterLogisticsLocation"], "findFirst">;
};

/**
 * Resolve a returning-depot code the same way the Create/Import UI catalogues them:
 * Prefer MasterSingaporeDepot (Portnet list from GET /master/singapore-depots),
 * then fall back to active MasterLogisticsLocation DEPOT rows (legacy placeholders).
 */
export async function resolveReturningDepotMasterByCode(
  prisma: PrismaDepotLookup,
  code: string | null | undefined,
): Promise<ResolvedReturningDepotMaster | null> {
  const trimmed = String(code ?? "").trim();
  if (!trimmed) return null;

  const singapore = await prisma.masterSingaporeDepot.findUnique({
    where: { code: trimmed },
    select: {
      code: true,
      addressLine1: true,
      addressLine2: true,
      postalCode: true,
      placeId: true,
      lat: true,
      lng: true,
    },
  });
  if (singapore?.addressLine1?.trim()) {
    return {
      code: singapore.code,
      addressLine1: singapore.addressLine1.trim(),
      addressLine2: singapore.addressLine2 ?? null,
      postalCode: singapore.postalCode ?? null,
      placeId: singapore.placeId ?? null,
      lat: singapore.lat ?? null,
      lng: singapore.lng ?? null,
      logisticsLocationId: null,
    };
  }

  const logistics = await prisma.masterLogisticsLocation.findFirst({
    where: {
      code: trimmed,
      type: LogisticsLocationType.DEPOT,
      isActive: true,
    },
    select: {
      id: true,
      code: true,
      addressLine1: true,
      addressLine2: true,
      postalCode: true,
      placeId: true,
      lat: true,
      lng: true,
    },
  });
  if (!logistics?.addressLine1?.trim()) return null;
  return {
    code: logistics.code,
    addressLine1: logistics.addressLine1.trim(),
    addressLine2: logistics.addressLine2 ?? null,
    postalCode: logistics.postalCode ?? null,
    placeId: logistics.placeId ?? null,
    lat: logistics.lat ?? null,
    lng: logistics.lng ?? null,
    logisticsLocationId: logistics.id,
  };
}

/** Resolve returningDepotId from Singapore depot masters first, then logistics DEPOT. */
export async function resolveReturningDepotCodeFromId(
  prisma: PrismaDepotLookup,
  locationId: string | null | undefined,
): Promise<string | null> {
  const id = String(locationId ?? "").trim();
  if (!id) return null;

  const singapore = await prisma.masterSingaporeDepot.findUnique({
    where: { id },
    select: { code: true },
  });
  if (singapore?.code?.trim()) return singapore.code.trim();

  const logistics = await prisma.masterLogisticsLocation.findFirst({
    where: { id, type: LogisticsLocationType.DEPOT, isActive: true },
    select: { code: true },
  });
  return logistics?.code?.trim() || null;
}
