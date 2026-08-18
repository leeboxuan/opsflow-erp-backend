import { BadRequestException } from "@nestjs/common";
import { JobTripTemplate, JobType } from "@prisma/client";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { CreateJobDto } from "./dto/create-job.dto";
import {
  assertCanonicalRouteLocationsForCreate,
  canonicalAutoTripRouteSnapshots,
  resolveCanonicalRouteLocations,
  type CanonicalRouteLocationInput,
} from "./job-route-locations";

/**
 * Exact generated boss-demo create bodies for BD-20260817-002.
 * Keep in lockstep with opsflow-erp-web-v2 e2e/helpers/boss-demo-job-payloads.ts.
 */
const ALPHA = "cmsrw61kf000gt8srpof1u151";
const BETA = "cmsxfnq900002dodaa8g1t5t5";
const PICKUP_DATE = "2026-08-17";

const REJECTED_BD_03 = {
  jobType: "EXPORT",
  customerCompanyId: ALPHA,
  externalRef: "BOSS-DEMO-EXP-001",
  pickupDate: PICKUP_DATE,
  pickupReference: "BOSS-DEMO-BD-03",
  description: "Boss-demo BD-03",
  carrierName: "Boss Demo Carrier",
  pickupAddress1: "1 Harbour Drive",
  pickupPostal: "619860",
  deliveryAddress1: "10 Tuas Avenue 3",
  deliveryPostal: "639405",
  items: [{ containerNumber: "EXP-BD-03", sealNo: "SEAL-BD-03" }],
} as const;

const BD_03 = {
  jobType: "EXPORT",
  customerCompanyId: ALPHA,
  externalRef: "BOSS-DEMO-EXP-001",
  pickupDate: PICKUP_DATE,
  pickupReference: "BOSS-DEMO-BD-03",
  description: "40' HC export — stuffed at Tuas Avenue 3, gated in at Pasir Panjang Terminal",
  carrierName: "Straits Feeder Lines Pte. Ltd.",
  voyage: "SS26E18",
  vesselName: "Straits Star",
  pickupAddress1: "7 Gul Circle",
  pickupPostal: "629567",
  deliveryAddress1: "10 Tuas Avenue 3",
  deliveryPostal: "639405",
  receiverName: "Warehouse Duty PIC",
  receiverPhone: "62614480",
  exportDetails: {
    stuffingAddress1: "10 Tuas Avenue 3",
    stuffingPostal: "639405",
    stuffingContactName: "Warehouse Duty PIC",
    stuffingContactPhone: "62614480",
    containerPickupAddress1: "7 Gul Circle",
    containerPickupPostal: "629567",
    exportPortAddress1: "Pasir Panjang Terminal",
    exportPortPostal: "117542",
    vesselName: "Straits Star",
  },
  items: [{ containerNumber: "MLCU2584910", sealNo: "04829163" }],
};

const BD_04 = {
  jobType: "LCL",
  customerCompanyId: BETA,
  externalRef: "BOSS-DEMO-LCL-BETA-001",
  pickupDate: PICKUP_DATE,
  pickupReference: "BOSS-DEMO-BD-04",
  description: "LCL consolidation — Pioneer Sector to Tuas warehouse",
  carrierName: "Straits Feeder Lines Pte. Ltd.",
  pickupAddress1: "15 Pioneer Sector 1",
  pickupPostal: "628437",
  deliveryAddress1: "10 Tuas Avenue 3",
  deliveryPostal: "639405",
  items: [{ description: "Palletised industrial fittings — 1.2 CBM", qty: 1, itemCode: "BOSS-DEMO-LCL-BD-04" }],
};

const BD_05 = {
  jobType: "IMPORT",
  customerCompanyId: BETA,
  externalRef: "BOSS-DEMO-IMP-BETA-001",
  pickupDate: PICKUP_DATE,
  pickupReference: "BOSS-DEMO-BD-05",
  description: "40' HC import — Tuas Port delivery to Tuas warehouse, empty return to Gul Circle",
  carrierName: "Straits Feeder Lines Pte. Ltd.",
  voyage: "SS26W17",
  vesselName: "Straits Star",
  pickupAddress1: "Tuas Port",
  pickupPostal: "637051",
  deliveryAddress1: "10 Tuas Avenue 3",
  deliveryPostal: "639405",
  receiverName: "Warehouse Duty PIC",
  receiverPhone: "62614480",
  importDetails: {
    vesselName: "Straits Star",
    returningDepotAddress1: "7 Gul Circle",
    returningDepotPostal: "629567",
  },
  items: [{ containerNumber: "MLCU2585074", sealNo: "11847205" }],
};

const BD_06 = {
  jobType: "LCL",
  customerCompanyId: ALPHA,
  externalRef: "BOSS-DEMO-LCL-ALPHA-001",
  pickupDate: PICKUP_DATE,
  pickupReference: "BOSS-DEMO-BD-06",
  description: "LCL unpacked cargo — Pioneer Sector to Tuas warehouse",
  carrierName: "Straits Feeder Lines Pte. Ltd.",
  pickupAddress1: "15 Pioneer Sector 1",
  pickupPostal: "628437",
  deliveryAddress1: "10 Tuas Avenue 3",
  deliveryPostal: "639405",
  items: [{ description: "Cartoned engineering spares — 0.8 CBM", qty: 1, itemCode: "BOSS-DEMO-LCL-BD-06" }],
};

const BD_07 = {
  jobType: "COLLECTION",
  collectionType: "EMPTY",
  customerCompanyId: BETA,
  externalRef: "BOSS-DEMO-COL1-BETA-001",
  pickupDate: PICKUP_DATE,
  pickupReference: "BOSS-DEMO-BD-07",
  description: "Empty container collection — Tuas warehouse to Gul Circle depot",
  carrierName: "Straits Feeder Lines Pte. Ltd.",
  pickupAddress1: "10 Tuas Avenue 3",
  pickupPostal: "639405",
  deliveryAddress1: "7 Gul Circle",
  deliveryPostal: "629567",
  items: [{ containerNumber: "MLCU2585156", sealNo: "22918374" }],
};

function canonicalInputFromCreateBody(body: Record<string, unknown>): CanonicalRouteLocationInput {
  const exportDetails = (body.exportDetails ?? {}) as Record<string, unknown>;
  const importDetails = (body.importDetails ?? {}) as Record<string, unknown>;
  return {
    jobType: body.jobType as JobType,
    pickupAddress1: body.pickupAddress1 as string | undefined,
    pickupPostal: body.pickupPostal as string | undefined,
    deliveryAddress1: body.deliveryAddress1 as string | undefined,
    deliveryPostal: body.deliveryPostal as string | undefined,
    receiverName: body.receiverName as string | undefined,
    receiverPhone: body.receiverPhone as string | undefined,
    exportDetails: {
      stuffingAddress1: exportDetails.stuffingAddress1 as string | undefined,
      stuffingPostal: exportDetails.stuffingPostal as string | undefined,
      stuffingContactName: exportDetails.stuffingContactName as string | undefined,
      stuffingContactPhone: exportDetails.stuffingContactPhone as string | undefined,
      containerPickupAddress1: exportDetails.containerPickupAddress1 as string | undefined,
      containerPickupPostal: exportDetails.containerPickupPostal as string | undefined,
      exportPortAddress1: exportDetails.exportPortAddress1 as string | undefined,
      exportPortPostal: exportDetails.exportPortPostal as string | undefined,
      exportPortCode: exportDetails.exportPortCode as string | undefined,
      pickupDepotCode: exportDetails.pickupDepotCode as string | undefined,
      exportOriginDepotCode: exportDetails.exportOriginDepotCode as string | undefined,
    },
    importDetails: {
      returningDepotAddress1: importDetails.returningDepotAddress1 as string | undefined,
      returningDepotPostal: importDetails.returningDepotPostal as string | undefined,
      returningDepotCode: importDetails.returningDepotCode as string | undefined,
      pickupPortCode: importDetails.pickupPortCode as string | undefined,
    },
  };
}

async function expectDtoValid(body: Record<string, unknown>): Promise<void> {
  const dto = plainToInstance(CreateJobDto, body);
  const errors = await validate(dto);
  expect(errors).toEqual([]);
}

describe("boss-demo generated create payloads vs CreateJobDto + canonical contract", () => {
  it("rejected BD-03 is DTO-valid and fails canonical create before any transaction write", async () => {
    await expectDtoValid({ ...REJECTED_BD_03 });
    const locations = resolveCanonicalRouteLocations(canonicalInputFromCreateBody({ ...REJECTED_BD_03 }));
    expect(locations.port?.address1).toBeFalsy();
    expect(locations.customer?.address1).toBe("10 Tuas Avenue 3");
    try {
      assertCanonicalRouteLocationsForCreate(JobType.EXPORT, locations);
      throw new Error("expected canonical rejection");
    } catch (err) {
      expect(err).toBeInstanceOf(BadRequestException);
      const response = (err as BadRequestException).getResponse();
      const message =
        typeof response === "string"
          ? response
          : String((response as { message?: string }).message ?? (err as Error).message);
      expect(message).toBe("Export port / terminal is required.");
      expect((err as BadRequestException).getStatus()).toBe(400);
    }
  });

  it("fixed BD-03 EXPORT is one Customer/Stuffing → Export Port Trip", async () => {
    await expectDtoValid(BD_03);
    const locations = resolveCanonicalRouteLocations(canonicalInputFromCreateBody(BD_03));
    expect(() => assertCanonicalRouteLocationsForCreate(JobType.EXPORT, locations)).not.toThrow();
    const snaps = canonicalAutoTripRouteSnapshots(JobType.EXPORT, locations);
    expect(Object.keys(snaps)).toEqual([JobTripTemplate.DELIVERY_TO_PORT]);
    expect(snaps[JobTripTemplate.DELIVERY_TO_PORT]?.originAddressLine1).toBe("10 Tuas Avenue 3");
    expect(snaps[JobTripTemplate.DELIVERY_TO_PORT]?.destinationAddressLine1).toBe(
      "Pasir Panjang Terminal",
    );
    expect(snaps[JobTripTemplate.DEPOT_TO_DELIVERY]).toBeUndefined();
    expect(BD_03.customerCompanyId).toBe(ALPHA);
    expect(BD_03.exportDetails.exportPortAddress1).toBe("Pasir Panjang Terminal");
    expect((BD_03 as { pickupDepotCode?: string }).pickupDepotCode).toBeUndefined();
  });

  it("fixed BD-04 LCL is one pickup → delivery Trip with qty", async () => {
    await expectDtoValid(BD_04);
    const locations = resolveCanonicalRouteLocations(canonicalInputFromCreateBody(BD_04));
    expect(() => assertCanonicalRouteLocationsForCreate(JobType.LCL, locations)).not.toThrow();
    const snaps = canonicalAutoTripRouteSnapshots(JobType.LCL, locations);
    expect(Object.keys(snaps)).toEqual([JobTripTemplate.PICKUP_TO_DELIVERY]);
    expect(BD_04.items[0].qty).toBe(1);
    expect(BD_04.customerCompanyId).toBe(BETA);
  });

  it("fixed BD-05 IMPORT is two Trips and requires return depot", async () => {
    await expectDtoValid(BD_05);
    const locations = resolveCanonicalRouteLocations(canonicalInputFromCreateBody(BD_05));
    expect(() => assertCanonicalRouteLocationsForCreate(JobType.IMPORT, locations)).not.toThrow();
    const snaps = canonicalAutoTripRouteSnapshots(JobType.IMPORT, locations);
    expect(Object.keys(snaps)).toEqual([
      JobTripTemplate.PICKUP_TO_DELIVERY,
      JobTripTemplate.DELIVERY_TO_DEPOT,
    ]);
    expect(snaps[JobTripTemplate.PICKUP_TO_DELIVERY]?.originAddressLine1).toBe("Tuas Port");
    expect(snaps[JobTripTemplate.PICKUP_TO_DELIVERY]?.destinationAddressLine1).toBe(
      "10 Tuas Avenue 3",
    );
    expect(snaps[JobTripTemplate.DELIVERY_TO_DEPOT]?.destinationAddressLine1).toBe("7 Gul Circle");
    expect(BD_05.customerCompanyId).toBe(BETA);
  });

  it("fixed BD-06 LCL binds Alpha", async () => {
    await expectDtoValid(BD_06);
    const locations = resolveCanonicalRouteLocations(canonicalInputFromCreateBody(BD_06));
    expect(() => assertCanonicalRouteLocationsForCreate(JobType.LCL, locations)).not.toThrow();
    expect(BD_06.customerCompanyId).toBe(ALPHA);
    expect(canonicalAutoTripRouteSnapshots(JobType.LCL, locations)[JobTripTemplate.PICKUP_TO_DELIVERY]).toBeTruthy();
  });

  it("fixed BD-07 COLLECTION is one EMPTY container Trip", async () => {
    await expectDtoValid(BD_07);
    const locations = resolveCanonicalRouteLocations(canonicalInputFromCreateBody(BD_07));
    expect(() =>
      assertCanonicalRouteLocationsForCreate(JobType.COLLECTION, locations),
    ).not.toThrow();
    const snaps = canonicalAutoTripRouteSnapshots(JobType.COLLECTION, locations);
    expect(Object.keys(snaps)).toEqual([JobTripTemplate.PICKUP_TO_DELIVERY]);
    expect(BD_07.collectionType).toBe("EMPTY");
    expect(BD_07.items).toHaveLength(1);
    expect(BD_07.customerCompanyId).toBe(BETA);
  });
});
