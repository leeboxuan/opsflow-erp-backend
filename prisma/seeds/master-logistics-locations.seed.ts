import { PrismaClient, LogisticsLocationType } from "@prisma/client";

const LOCATIONS: Array<{
  code: string;
  name: string;
  type: LogisticsLocationType;
  addressLine1: string;
  addressLine2: string | null;
  postalCode: string | null;
  country: string;
  lat: number;
  lng: number;
  placeId: string | null;
  sortOrder: number;
}> = [
  {
    code: "JURONG_PORT",
    name: "Jurong Port",
    type: LogisticsLocationType.PORT,
    addressLine1: "37 Jurong Port Road",
    addressLine2: null,
    postalCode: "619110",
    country: "SG",
    lat: 1.30841,
    lng: 103.70813,
    placeId: null,
    sortOrder: 10,
  },
  {
    code: "PASIR_PANJANG",
    name: "Pasir Panjang Terminal",
    type: LogisticsLocationType.PORT,
    addressLine1: "Pasir Panjang Terminal Building 3",
    addressLine2: "25 Harbour Drive",
    postalCode: "117612",
    country: "SG",
    lat: 1.27526,
    lng: 103.76456,
    placeId: null,
    sortOrder: 20,
  },
  {
    code: "TUAS_PORT",
    name: "Tuas Port",
    type: LogisticsLocationType.PORT,
    addressLine1: "Tuas Port",
    addressLine2: "Tuas South Boulevard",
    postalCode: "637236",
    country: "SG",
    lat: 1.23974,
    lng: 103.62582,
    placeId: null,
    sortOrder: 30,
  },
  {
    code: "KEPPEL_TERMINAL",
    name: "Keppel Terminal",
    type: LogisticsLocationType.PORT,
    addressLine1: "Keppel Distripark",
    addressLine2: "511 Kampong Bahru Road",
    postalCode: "099447",
    country: "SG",
    lat: 1.27354,
    lng: 103.84129,
    placeId: null,
    sortOrder: 40,
  },
  {
    code: "GUL7_DEPOT",
    name: "7 Gul Circle (default)",
    type: LogisticsLocationType.DEPOT,
    addressLine1: "7 Gul Circle",
    addressLine2: null,
    postalCode: "629563",
    country: "SG",
    lat: 1.30995,
    lng: 103.65573,
    placeId: null,
    sortOrder: 110,
  },
  {
    code: "TUAS_DEPOT",
    name: "Tuas Depot",
    type: LogisticsLocationType.DEPOT,
    addressLine1: "15 Tuas Avenue 18",
    addressLine2: null,
    postalCode: "638898",
    country: "SG",
    lat: 1.32545,
    lng: 103.64648,
    placeId: null,
    sortOrder: 120,
  },
  {
    code: "PASIR_PANJANG_DEPOT",
    name: "Pasir Panjang Depot",
    type: LogisticsLocationType.DEPOT,
    addressLine1: "30 Pasir Panjang Road",
    addressLine2: null,
    postalCode: "118503",
    country: "SG",
    lat: 1.28124,
    lng: 103.78309,
    placeId: null,
    sortOrder: 130,
  },
];

export async function seedMasterLogisticsLocations(prisma: PrismaClient) {
  for (const row of LOCATIONS) {
    await prisma.masterLogisticsLocation.upsert({
      where: { code: row.code },
      update: {
        ...row,
        label: `${row.code} — ${row.name}`,
        isActive: true,
      },
      create: {
        ...row,
        label: `${row.code} — ${row.name}`,
        isActive: true,
      },
    });
  }
}

if (require.main === module) {
  const prisma = new PrismaClient();
  seedMasterLogisticsLocations(prisma)
    .then(async () => {
      // eslint-disable-next-line no-console
      console.log("seedMasterLogisticsLocations done");
      await prisma.$disconnect();
    })
    .catch(async (error) => {
      // eslint-disable-next-line no-console
      console.error(error);
      await prisma.$disconnect();
      process.exit(1);
    });
}
