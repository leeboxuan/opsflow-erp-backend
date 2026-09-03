import { PrismaClient } from "@prisma/client";

/**
 * Official PSA Portnet Depot Operators catalogue (subset requested for OpsFlow).
 * Source: https://wwwsg.portnet.com/public/api/media/miscellaneous/PSAContacts.pdf?inline=true
 *
 * Upsert by stable `code` only — additive; does not delete placeholders or jobs.
 */

export const PORTNET_DEPOT_SOURCE_URL =
  "https://wwwsg.portnet.com/public/api/media/miscellaneous/PSAContacts.pdf?inline=true";

export type SingaporeDepotSeedRow = {
  /** Fixed id only for legacy placeholders; official rows omit id (cuid on create). */
  id?: string;
  code: string;
  name: string;
  addressLine1: string | null;
  addressLine2: string | null;
  postalCode: string | null;
  country: string;
  lat: number | null;
  lng: number | null;
  placeId: string | null;
  operatingHoursSummary: string | null;
};

const PSA_HOURS =
  "Mon–Fri 08:00–17:00; Sat 08:00–15:00; Sun/PH closed";
const ACS_HOURS = "Mon–Fri 08:00–17:00; Sat 08:00–15:00";
const CWT_HOURS =
  "Mon–Fri 08:30–18:30; Sat 08:30–15:00; Sun/PH closed";

function depot(
  code: string,
  name: string,
  addressLine1: string,
  operatingHoursSummary: string | null,
  extras?: Partial<
    Pick<SingaporeDepotSeedRow, "addressLine2" | "postalCode" | "lat" | "lng" | "placeId">
  >,
): SingaporeDepotSeedRow {
  return {
    code,
    name,
    addressLine1,
    addressLine2: extras?.addressLine2 ?? null,
    postalCode: extras?.postalCode ?? null,
    country: "SG",
    lat: extras?.lat ?? null,
    lng: extras?.lng ?? null,
    placeId: extras?.placeId ?? null,
    operatingHoursSummary,
  };
}

/**
 * Legacy placeholder masters — keep codes stable for Draft jobs.
 * Hours intentionally null (not in Portnet catalogue as these codes).
 */
export const PLACEHOLDER_SINGAPORE_DEPOTS: SingaporeDepotSeedRow[] = [
  {
    id: "msd_gul7",
    code: "GUL7",
    name: "7 Gul Circle warehouse / yard",
    addressLine1: "7 Gul Circle",
    addressLine2: null,
    postalCode: "629563",
    country: "SG",
    lat: 1.3107274,
    lng: 103.6749418,
    placeId: null,
    operatingHoursSummary: null,
  },
  {
    id: "msd_gul_default",
    code: "GUL_DEFAULT",
    name: "7 Gul Circle - default return",
    addressLine1: "7 Gul Circle",
    addressLine2: null,
    postalCode: "629563",
    country: "SG",
    lat: 1.3107274,
    lng: 103.6749418,
    placeId: null,
    operatingHoursSummary: null,
  },
  {
    id: "msd_tuas",
    code: "TUAS_DEPOT",
    name: "Tuas logistics depot (placeholder)",
    addressLine1: "15 Tuas Avenue 18",
    addressLine2: null,
    postalCode: "638898",
    country: "SG",
    lat: 1.32545,
    lng: 103.64648,
    placeId: null,
    operatingHoursSummary: null,
  },
  {
    id: "msd_pasir",
    code: "PASIR_DEPOT",
    name: "Pasir Panjang area depot (placeholder)",
    addressLine1: "30 Pasir Panjang Road",
    addressLine2: null,
    postalCode: "118503",
    country: "SG",
    lat: 1.28124,
    lng: 103.78309,
    placeId: null,
    operatingHoursSummary: null,
  },
];

/** Official Portnet depot codes prepared for OpsFlow (verified against PDF). */
export const OFFICIAL_PORTNET_SINGAPORE_DEPOTS: SingaporeDepotSeedRow[] = [
  depot(
    "PSA1",
    "PSA Corporation",
    "Keppel Terminal, Yard Block Q12",
    PSA_HOURS,
  ),
  depot(
    "PSA4",
    "PSA Corporation",
    "Pasir Panjang Terminal, Yard Block P12",
    PSA_HOURS,
  ),
  depot("TTG1", "PSA Corporation", "PSA Tuas Depot", PSA_HOURS),

  depot(
    "ACS1",
    "Allied Container Services",
    "1 Tuas Basin Lane, Singapore 637066",
    ACS_HOURS,
    { postalCode: "637066" },
  ),
  depot(
    "ACS2",
    "Allied Container Services",
    "14 Pioneer Sector 2, Singapore 628375",
    ACS_HOURS,
    { postalCode: "628375" },
  ),
  depot(
    "ACS3",
    "Allied Container Services",
    "25 Penjuru Lane, Singapore 609194",
    ACS_HOURS,
    { postalCode: "609194" },
  ),
  depot(
    "ACS5",
    "Allied Container Services",
    "18A Penjuru Road, Singapore 609126",
    ACS_HOURS,
    { postalCode: "609126" },
  ),
  depot(
    "ACS6",
    "Allied Container Services",
    "1 Banyan Place, Jurong Island",
    ACS_HOURS,
  ),
  depot(
    "ACS8",
    "Allied Container Services",
    "15 Pioneer Crescent, Singapore 628551",
    ACS_HOURS,
    { postalCode: "628551" },
  ),

  depot(
    "ACW1",
    "Associated Carriage & Warehousing",
    "36 Penjuru Lane",
    "Mon–Fri 08:30–17:00; lunch 13:00–14:00; weekend 08:30–12:45",
  ),
  depot(
    "BST1",
    "Bok Seng Logistics",
    "5 Tuas Avenue 3",
    "Mon–Fri 08:30–16:45; lunch 12:00–13:00; Sat until 15:00",
  ),
  depot(
    "CUA2",
    "Chuan Li Container",
    "12A Refinery Road, Singapore 628193",
    "Mon–Fri 08:30–16:45; Sat 08:30–13:45",
    { postalCode: "628193" },
  ),
  depot(
    "CNP1",
    "Container Connections Dry Depot",
    "14 Tuas View Circuit",
    "Mon–Fri 08:30–17:30; Sat 08:30–12:30",
  ),
  depot(
    "CNP2",
    "Container Connections ISO Tank Depot",
    "16 Tuas View Circuit",
    "Mon–Fri 08:30–17:30; Sat 08:30–15:00",
  ),

  depot(
    "CWT1",
    "CWT Integrated",
    "47 Jalan Buroh, Singapore 619491",
    CWT_HOURS,
    { postalCode: "619491" },
  ),
  depot(
    "CWT2",
    "CWT Integrated",
    "12 Tuas South Street 2, Singapore 638039",
    CWT_HOURS,
    { postalCode: "638039" },
  ),
  depot(
    "CWT3",
    "CWT Integrated",
    "22 Pioneer Sector 2, Singapore 628380",
    CWT_HOURS,
    { postalCode: "628380" },
  ),
  depot(
    "CWT4",
    "CWT Integrated",
    "42C Penjuru Road, Singapore 609147",
    CWT_HOURS,
    { postalCode: "609147" },
  ),

  depot(
    "EYK1",
    "Eng Kong Pioneer",
    "30 Pioneer Sector 2",
    "Mon–Fri 08:30–17:00; lunch 13:00–13:30; weekend 08:30–15:00",
  ),
  depot(
    "EYK2",
    "Eng Kong 11",
    "15 Tuas Avenue 11",
    "Mon–Fri 08:30–17:00; lunch 12:00–12:30; weekend 08:30–15:00",
  ),
  depot(
    "EYK3",
    "Eng Kong 13",
    "8A Tuas Avenue 13",
    "Mon–Fri 08:30–17:00; lunch 12:00–12:30; weekend 08:30–15:00",
  ),
  depot(
    "EYK4",
    "Eng Kong Tuas South",
    "Tuas South Street 5",
    "Mon–Fri 08:30–17:00; weekend 08:30–15:00",
  ),

  depot(
    "GCO1",
    "Goldstream Containers",
    "18 Penjuru Road",
    "Mon–Fri 08:30–16:30; lunch 12:00–13:00; weekend 08:30–12:30",
  ),
  depot(
    "HNL1",
    "Hean Nerng Logistics / Milkyway Tank Depot",
    "7 Gul Avenue, Singapore 629651",
    "Mon–Fri 08:30–17:30; weekend 08:30–12:00",
    { postalCode: "629651" },
  ),
  depot(
    "HTS1",
    "HLA Container Services",
    "9 Gul Circle, Singapore 629565",
    "Mon–Fri 08:00–18:00; weekend 08:00–15:00",
    { postalCode: "629565" },
  ),
  depot(
    "HTS2",
    "HLA Container Services",
    "9 Gul Circle, Singapore 629565",
    "Mon–Fri 08:00–18:00; weekend 08:00–15:00",
    { postalCode: "629565" },
  ),

  depot(
    "JWC1",
    "Joint Win Container Logistics",
    "11 Jalan Terusan",
    "Mon–Fri 08:30–17:15; Sat 08:30–14:45",
  ),
  depot(
    "KWY1",
    "Kawaly Transport Services",
    "18 Penjuru Road",
    "Mon–Fri 08:30–17:00; lunch 12:00–13:00; Sat 08:30–15:00",
  ),
  depot(
    "LKG1",
    "Likok Logistics",
    "22 Pioneer Sector 2, Singapore 628380",
    "Mon–Fri 08:30–17:30; lunch 12:00–13:00; Sat 08:30–12:30",
    { postalCode: "628380" },
  ),
  depot(
    "LKG2",
    "Likok Logistics",
    "20 Gul Way Level 1, Singapore 629196",
    "Mon–Fri 08:00–18:00; Sat 08:00–15:00",
    { postalCode: "629196" },
  ),
  depot(
    "MFH1",
    "Masterfaith",
    "Tuas South Avenue 2",
    "Mon–Fri 08:00–17:00; Sat 08:00–12:00",
  ),
  depot(
    "MOS1",
    "Mostrans",
    "29 Penjuru Lane",
    "Mon–Fri 08:00–17:00; lunch 12:00–13:00; Sat 08:30–15:00",
  ),

  depot(
    "OCW1",
    "OCWS Logistics",
    "22 Pioneer Sector 2",
    "Mon–Fri 08:30–17:00; Sat 08:30–14:45",
  ),
  depot(
    "OCW2",
    "OCWS Penjuru",
    "42C Penjuru Road",
    "Mon–Fri 08:30–17:00; Sat 08:30–15:00",
  ),
  depot(
    "OCW3",
    "OCWS Tuas",
    "12 Tuas South Street 2",
    "Mon–Fri 08:30–17:00; Sat 08:30–15:00",
  ),
  depot(
    "OCW4",
    "OCWS Tuas",
    "10 Tuas South Street 2, Singapore 637896",
    null,
    { postalCode: "637896" },
  ),

  depot(
    "PCG1",
    "Pacific Container & Godown",
    "30 Tuas Avenue 13",
    "Mon–Fri 08:45–17:15; lunch 12:30–13:30; Sat 08:30–15:00",
  ),
  depot(
    "PSC1",
    "PH Containers Express",
    "23 Pioneer Sector 1, Singapore 628431",
    "Mon–Fri 08:30–17:00; Sat 08:30–15:00",
    { postalCode: "628431" },
  ),
  depot(
    "PDP1",
    "Pioneer Districentre",
    "10 Tuas Avenue 13",
    "Mon–Fri 08:30–17:00; lunch 12:00–13:00; Sat 08:30–12:00",
  ),

  depot(
    "SST1",
    "Sea-Shore Transportation",
    "8 Benoi Sector",
    "Mon–Fri 08:30–17:45; lunch 12:00–13:00; Sat 08:30–14:45",
  ),
  depot(
    "SST2",
    "Sea-Shore Transportation",
    "8 Benoi Sector",
    "Mon–Fri 08:30–17:45; lunch 12:30–13:30; Sat until 15:00",
  ),
  depot(
    "SST3",
    "Sea-Shore Transportation",
    "14 Pioneer Sector 2",
    "Mon–Fri 08:00–17:00; lunch 12:30–13:30; Sat 08:30–14:30",
  ),
  depot(
    "SKT1",
    "Sen Kee Transportation",
    "30 Jalan Terusan",
    "Mon–Fri 09:00–17:00; lunch 12:45–14:00; Sat 09:00–14:00",
  ),

  depot(
    "CGC1",
    "Cogent Container Depot",
    "Cogent 1 Logistics Hub, 1 Buroh Crescent #06-01, Singapore 627545",
    "Mon–Fri 08:30–19:00; Sat 08:30–15:00",
    { postalCode: "627545" },
  ),
  depot(
    "CGC2",
    "Cogent Jurong Island",
    "30 Tembusu Avenue, Singapore 627808",
    "Mon–Fri 08:30–17:00; Sat 08:30–15:00",
    { postalCode: "627808" },
  ),
];

export const ALL_SINGAPORE_DEPOT_SEED_ROWS: SingaporeDepotSeedRow[] = [
  ...PLACEHOLDER_SINGAPORE_DEPOTS,
  ...OFFICIAL_PORTNET_SINGAPORE_DEPOTS,
];

export function assertUniqueSingaporeDepotCodes(
  rows: SingaporeDepotSeedRow[] = ALL_SINGAPORE_DEPOT_SEED_ROWS,
): string[] {
  const codes = rows.map((r) => r.code);
  const seen = new Set<string>();
  const dupes: string[] = [];
  for (const code of codes) {
    if (seen.has(code)) dupes.push(code);
    seen.add(code);
  }
  if (dupes.length) {
    throw new Error(`Duplicate Singapore depot codes: ${dupes.join(", ")}`);
  }
  return codes;
}

export async function seedSingaporeDepots(prisma: PrismaClient): Promise<void> {
  assertUniqueSingaporeDepotCodes();

  for (const row of ALL_SINGAPORE_DEPOT_SEED_ROWS) {
    // Upsert by stable PSA/legacy `code` only. Do not force placeholder `id`s —
    // existing DBs may already own those primary keys under different rows.
    const { id: _ignoredId, ...data } = row;
    await prisma.masterSingaporeDepot.upsert({
      where: { code: data.code },
      update: data,
      create: data,
    });
  }
}

if (require.main === module) {
  const prisma = new PrismaClient();
  seedSingaporeDepots(prisma)
    .then(async () => {
      // eslint-disable-next-line no-console
      console.log("seedSingaporeDepots done");
      await prisma.$disconnect();
    })
    .catch(async (error) => {
      // eslint-disable-next-line no-console
      console.error(error);
      await prisma.$disconnect();
      process.exit(1);
    });
}
