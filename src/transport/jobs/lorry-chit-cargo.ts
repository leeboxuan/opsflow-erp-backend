import { BadRequestException } from "@nestjs/common";
import type { LorryChitCargoRow } from "../documents/lorry-chit-pdf";

/**
 * Canonical cargo for a Lorry Chit: exactly one TripJobItem link per Trip.
 * Never silently pick the first of many — flag for review instead.
 */

export type LorryChitLinkLike = {
  id?: string;
  jobItemId: string;
  containerNumberSnapshot?: string | null;
  jobItem?: {
    id?: string;
    itemCode?: string | null;
    description?: string | null;
    sealNo?: string | null;
    containerSize?: string | null;
    qty?: number | null;
  } | null;
};

export type ResolvedLorryChitCargo = {
  jobItemId: string;
  /** Blank when Collection draft has null itemCode — do not invent "pending". */
  cargoRow: LorryChitCargoRow;
  containerNumber: string | null;
};

export function resolveLorryChitCargoFromTripLinks(
  links: LorryChitLinkLike[],
  opts?: { tripId?: string | null },
): ResolvedLorryChitCargo {
  const tripHint = opts?.tripId ? ` tripId=${opts.tripId}` : "";
  const rows = Array.isArray(links) ? links : [];

  if (rows.length === 0) {
    throw new BadRequestException(
      `Lorry Chit requires exactly one TripJobItem link for this Trip; found 0.${tripHint} Flag for review.`,
    );
  }

  if (rows.length > 1) {
    const ids = rows.map((l) => l.jobItemId).filter(Boolean);
    throw new BadRequestException(
      `Lorry Chit expects one container per Trip but found ${rows.length} TripJobItem links` +
        ` [${ids.join(", ")}].${tripHint} Do not auto-select; flag for review.`,
    );
  }

  const link = rows[0]!;
  const item = link.jobItem ?? null;
  const containerNumber =
    String(item?.itemCode ?? "").trim()
    || String(link.containerNumberSnapshot ?? "").trim()
    || null;

  const sizeOrPackage =
    String(item?.containerSize ?? "").trim()
    || (item?.qty != null ? `x${item.qty}` : "");

  const remarksParts = [
    item?.sealNo ? `Seal: ${String(item.sealNo).trim()}` : "",
    item?.description ? String(item.description).trim() : "",
  ].filter(Boolean);

  return {
    jobItemId: link.jobItemId,
    containerNumber,
    cargoRow: {
      // Collection null container → blank on draft (not "pending").
      containerOrCargo: containerNumber ?? "",
      sizeOrPackage,
      remarks: remarksParts.join(" · "),
    },
  };
}

/** Build the single-row cargo payload for PDF generation. */
export function lorryChitCargoRowsFromResolved(
  resolved: ResolvedLorryChitCargo,
): LorryChitCargoRow[] {
  return [resolved.cargoRow];
}
