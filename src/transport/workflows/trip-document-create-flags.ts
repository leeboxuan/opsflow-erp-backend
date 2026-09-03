export type TripDocumentCreateFlags = {
  signedDeliveryDoRequired?: boolean;
  signedLorryChitRequired?: boolean;
};

export type AutoTripDocumentRequirementInput = TripDocumentCreateFlags & {
  tripIndex?: number;
};

export function normalizeTripDocumentCreateFlags(
  input?: TripDocumentCreateFlags | null,
): { signedDeliveryDoRequired: boolean; signedLorryChitRequired: boolean } {
  return {
    signedDeliveryDoRequired: input?.signedDeliveryDoRequired === true,
    signedLorryChitRequired: input?.signedLorryChitRequired === true,
  };
}

export function normalizeAutoTripDocumentRequirements(
  raw: unknown,
): Array<{
  tripIndex: number;
  signedDeliveryDoRequired: boolean;
  signedLorryChitRequired: boolean;
}> {
  if (!Array.isArray(raw)) return [];
  return raw.map((row, index) => {
    const rec = row && typeof row === "object" ? (row as Record<string, unknown>) : {};
    const parsedIndex = Number(rec.tripIndex);
    return {
      tripIndex: Number.isFinite(parsedIndex) ? parsedIndex : index,
      signedDeliveryDoRequired: rec.signedDeliveryDoRequired === true,
      signedLorryChitRequired: rec.signedLorryChitRequired === true,
    };
  });
}

export function flagsForGeneratedTrip(
  requirements: Array<{
    tripIndex: number;
    signedDeliveryDoRequired: boolean;
    signedLorryChitRequired: boolean;
  }>,
  tripIndex: number,
): { signedDeliveryDoRequired: boolean; signedLorryChitRequired: boolean } {
  const match =
    requirements.find((row) => row.tripIndex === tripIndex) ?? requirements[tripIndex];
  return normalizeTripDocumentCreateFlags(match);
}
