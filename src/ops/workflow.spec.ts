import { JobTripTemplate, JobType, TripDocumentType } from "@prisma/client";
import {
  completionRuleForTemplate,
  GUL_CIRCLE_ROUTE_DEFAULTS,
  jobTripTemplateDisplayLabel,
  lclPickupToDeliveryRouteSnapshot,
  resolveAppendTripRouteSnapshot,
  tripCreateManyForJob,
  TRIP_COMPLETION_RULES,
} from "./job-workflow.helpers";
import {
  parseQuotationRateLinesFromDocxBuffer,
  parseQuotationRateLinesFromXlsxBuffer,
} from "../customers/quotation-parse.helpers";

describe("workflow helpers", () => {
  it("tripCreateManyForJob creates two IMPORT legs", () => {
    const rows = tripCreateManyForJob(
      "t1",
      "j1",
      JobType.IMPORT,
      new Date("2026-03-15"),
      null,
      null,
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].jobSequence).toBe(1);
    expect(rows[1].jobSequence).toBe(2);
    expect(rows[0].jobTripTemplate).toBe(JobTripTemplate.PICKUP_TO_DELIVERY);
    expect(rows[0].completionRuleJson).toEqual({
      requireGeneratedDoSigned: true,
      tripUploads: {
        minUploadCount: 2,
        allowedUploadTypes: [TripDocumentType.PICKUP_DO, TripDocumentType.POD_SIGNATURE],
        requiredUploadTypesExact: [TripDocumentType.PICKUP_DO, TripDocumentType.POD_SIGNATURE],
      },
    });
    expect(rows[1].jobTripTemplate).toBe(JobTripTemplate.DELIVERY_TO_DEPOT);
    expect(rows[1].completionRuleJson).toEqual({
      requireGeneratedDoSigned: true,
      tripUploads: {
        minUploadCount: 1,
        allowedUploadTypes: [TripDocumentType.PICKUP_DO],
        requiredUploadTypesExact: [TripDocumentType.PICKUP_DO],
      },
    });
    expect(rows[0].status).toBe("DRAFT");
    expect(rows[1].status).toBe("DRAFT");
  });

  it("tripCreateManyForJob accepts route snapshot overrides", () => {
    const rows = tripCreateManyForJob(
      "t1",
      "j1",
      JobType.IMPORT,
      new Date("2026-03-15"),
      null,
      null,
      {
        [JobTripTemplate.PICKUP_TO_DELIVERY]: {
          originLabel: "BRANI — Brani Terminal",
          destinationLabel: "Delivery Address",
        },
      },
    );
    expect(rows[0].originLabel).toBe("BRANI — Brani Terminal");
    expect(rows[0].destinationLabel).toBe("Delivery Address");
  });

  it("tripCreateManyForJob creates two EXPORT legs", () => {
    const rows = tripCreateManyForJob(
      "t1",
      "j1",
      JobType.EXPORT,
      new Date("2026-03-15"),
      null,
      null,
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].jobTripTemplate).toBe(JobTripTemplate.DEPOT_TO_DELIVERY);
    expect(rows[0].completionRuleJson).toEqual({
      requireGeneratedDoSigned: true,
      tripUploads: {
        minUploadCount: 2,
        allowedUploadTypes: [TripDocumentType.PICKUP_DO, TripDocumentType.POD_SIGNATURE],
        requiredUploadTypesExact: [TripDocumentType.PICKUP_DO, TripDocumentType.POD_SIGNATURE],
      },
    });
    expect(rows[1].jobTripTemplate).toBe(JobTripTemplate.DELIVERY_TO_PORT);
    expect(rows[1].completionRuleJson).toEqual({
      requireGeneratedDoSigned: true,
      tripUploads: {
        minUploadCount: 1,
        allowedUploadTypes: [TripDocumentType.POD_SIGNATURE],
        requiredUploadTypesExact: [TripDocumentType.POD_SIGNATURE],
      },
    });
    expect(rows[0].status).toBe("DRAFT");
    expect(rows[1].status).toBe("DRAFT");
  });

  it("lclPickupToDeliveryRouteSnapshot maps pickup and delivery text without geo", () => {
    const snap = lclPickupToDeliveryRouteSnapshot({
      pickupAddress1: "7 Gul Cir, 7 Gul Circle",
      pickupPostal: "629563",
      deliveryAddress1: "8 Gul Cir, 8 Gul Circle",
      deliveryPostal: "629564",
    });
    expect(snap).toEqual({
      originLabel: "7 Gul Cir, 7 Gul Circle",
      originAddressLine1: "7 Gul Cir, 7 Gul Circle",
      originAddressLine2: null,
      originPostalCode: "629563",
      originCountry: "SG",
      originLat: null,
      originLng: null,
      originPlaceId: null,
      destinationLabel: "8 Gul Cir, 8 Gul Circle",
      destinationAddressLine1: "8 Gul Cir, 8 Gul Circle",
      destinationAddressLine2: null,
      destinationPostalCode: "629564",
      destinationCountry: "SG",
      destinationLat: null,
      destinationLng: null,
      destinationPlaceId: null,
    });
  });

  it("tripCreateManyForJob LCL applies pickup/delivery route snapshot on generated leg", () => {
    const route = lclPickupToDeliveryRouteSnapshot({
      pickupAddress1: "7 Gul Cir, 7 Gul Circle",
      pickupPostal: "629563",
      deliveryAddress1: "8 Gul Cir, 8 Gul Circle",
      deliveryPostal: "629564",
      deliveryPlaceId: "ChIJdest",
      deliveryLat: 1.31,
      deliveryLng: 103.67,
    });
    const rows = tripCreateManyForJob(
      "t1",
      "j1",
      JobType.LCL,
      new Date("2026-05-21"),
      null,
      null,
      { [JobTripTemplate.PICKUP_TO_DELIVERY]: route },
    );
    expect(rows[0]).toMatchObject({
      originLabel: "7 Gul Cir, 7 Gul Circle",
      originAddressLine1: "7 Gul Cir, 7 Gul Circle",
      originPostalCode: "629563",
      originCountry: "SG",
      destinationLabel: "8 Gul Cir, 8 Gul Circle",
      destinationAddressLine1: "8 Gul Cir, 8 Gul Circle",
      destinationPostalCode: "629564",
      destinationCountry: "SG",
      destinationPlaceId: "ChIJdest",
      destinationLat: 1.31,
      destinationLng: 103.67,
    });
  });

  it("tripCreateManyForJob creates one LCL leg with expected completion rule", () => {
    const rows = tripCreateManyForJob(
      "t1",
      "j1",
      JobType.LCL,
      new Date("2026-03-15"),
      null,
      null,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].jobTripTemplate).toBe(JobTripTemplate.PICKUP_TO_DELIVERY);
    expect(rows[0].completionRuleJson).toEqual({
      requireGeneratedDoSigned: true,
      tripUploads: {
        minUploadCount: 2,
        allowedUploadTypes: [TripDocumentType.PICKUP_DO, TripDocumentType.POD_SIGNATURE],
        requiredUploadTypesExact: [TripDocumentType.PICKUP_DO, TripDocumentType.POD_SIGNATURE],
      },
    });
    expect(rows[0].status).toBe("DRAFT");
    expect(rows[0].containerNumber).toBeNull();
    expect(rows[0].carrier).toBeNull();
    expect(rows[0].shipper).toBeNull();
    expect(rows[0].vessel).toBeNull();
  });

  it("tripCreateManyForJob LCL does not seed container or shipping refs even when passed", () => {
    const rows = tripCreateManyForJob(
      "t1",
      "j1",
      JobType.LCL,
      new Date("2026-03-15"),
      "  LEGACY-CONT  ",
      {
        carrier: "  MAERSK ",
        shipper: "  ACME ",
        vessel: "  VESSEL-X ",
      },
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].containerNumber).toBeNull();
    expect(rows[0].carrier).toBeNull();
    expect(rows[0].shipper).toBeNull();
    expect(rows[0].vessel).toBeNull();
  });

  it("tripCreateManyForJob LCL clears cargo/shipping after route snapshots", () => {
    const rows = tripCreateManyForJob(
      "t1",
      "j1",
      JobType.LCL,
      new Date("2026-03-15"),
      null,
      null,
      {
        [JobTripTemplate.PICKUP_TO_DELIVERY]: {
          containerNumber: "from-snapshot",
          carrier: "X",
          shipper: "Y",
          vessel: "Z",
          originLabel: "Warehouse",
        },
      },
    );
    expect(rows[0].originLabel).toBe("Warehouse");
    expect(rows[0].containerNumber).toBeNull();
    expect(rows[0].carrier).toBeNull();
    expect(rows[0].shipper).toBeNull();
    expect(rows[0].vessel).toBeNull();
  });

  it("completionRuleForTemplate uses explicit per-template rule map", () => {
    expect(completionRuleForTemplate(JobTripTemplate.PICKUP_TO_DELIVERY)).toEqual(
      TRIP_COMPLETION_RULES[JobTripTemplate.PICKUP_TO_DELIVERY],
    );
    expect(completionRuleForTemplate(JobTripTemplate.DELIVERY_TO_DEPOT)).toEqual(
      TRIP_COMPLETION_RULES[JobTripTemplate.DELIVERY_TO_DEPOT],
    );
    expect(completionRuleForTemplate(JobTripTemplate.DEPOT_TO_DELIVERY)).toEqual(
      TRIP_COMPLETION_RULES[JobTripTemplate.DEPOT_TO_DELIVERY],
    );
    expect(completionRuleForTemplate(JobTripTemplate.DELIVERY_TO_PORT)).toEqual(
      TRIP_COMPLETION_RULES[JobTripTemplate.DELIVERY_TO_PORT],
    );
    expect(completionRuleForTemplate(JobTripTemplate.CUSTOMER_TO_GUL)).toEqual(
      TRIP_COMPLETION_RULES[JobTripTemplate.CUSTOMER_TO_GUL],
    );
    expect(completionRuleForTemplate(JobTripTemplate.GUL_TO_CUSTOMER)).toEqual(
      TRIP_COMPLETION_RULES[JobTripTemplate.GUL_TO_CUSTOMER],
    );
    expect(completionRuleForTemplate(JobTripTemplate.CUSTOM)).toEqual(
      TRIP_COMPLETION_RULES[JobTripTemplate.CUSTOM],
    );
  });

  it("jobTripTemplateDisplayLabel maps Gul Circle shortcuts", () => {
    expect(jobTripTemplateDisplayLabel(JobTripTemplate.CUSTOMER_TO_GUL)).toBe(
      "Customer → Gul Circle",
    );
    expect(jobTripTemplateDisplayLabel(JobTripTemplate.GUL_TO_CUSTOMER)).toBe(
      "Gul Circle → Customer",
    );
  });

  it("resolveAppendTripRouteSnapshot fills map-ready Gul Circle coordinates", () => {
    const toGul = resolveAppendTripRouteSnapshot(JobTripTemplate.CUSTOMER_TO_GUL, {
      originSummary: "8 Gul Cir, 8 Gul Circle",
      originPostalCode: "629564",
      originLat: 1.3136718,
      originLng: 103.6730866,
      destinationSummary: "7 Gul Circle",
      destinationPostalCode: "629563",
      destinationLat: null,
      destinationLng: null,
    });
    expect(toGul.originLabel).toBe("8 Gul Cir, 8 Gul Circle");
    expect(toGul.destinationLabel).toBe("7 Gul Circle");
    expect(toGul.destinationLat).toBe(GUL_CIRCLE_ROUTE_DEFAULTS.lat);
    expect(toGul.destinationLng).toBe(GUL_CIRCLE_ROUTE_DEFAULTS.lng);
    expect(toGul.destinationAddressLine1).toBe("7 Gul Circle");

    const fromGul = resolveAppendTripRouteSnapshot(JobTripTemplate.GUL_TO_CUSTOMER, {
      destinationSummary: "Customer site",
    });
    expect(fromGul.originLabel).toBe("7 Gul Circle");
    expect(fromGul.originLat).toBe(GUL_CIRCLE_ROUTE_DEFAULTS.lat);
    expect(fromGul.originLng).toBe(GUL_CIRCLE_ROUTE_DEFAULTS.lng);
    expect(fromGul.destinationLat).toBeNull();
  });

  it("tripCreateManyForJob seeds containerNumber onto IMPORT-generated trips", () => {
    const rows = tripCreateManyForJob(
      "t1",
      "j1",
      JobType.IMPORT,
      new Date("2026-03-15"),
      "  CONT-001  ",
      null,
    );
    expect(rows.every((r) => r.containerNumber === "CONT-001")).toBe(true);
  });

  it("tripCreateManyForJob seeds containerNumber onto EXPORT-generated trips", () => {
    const rows = tripCreateManyForJob(
      "t1",
      "j1",
      JobType.EXPORT,
      new Date("2026-03-15"),
      "  CONT-EXP-01  ",
      null,
    );
    expect(rows.every((r) => r.containerNumber === "CONT-EXP-01")).toBe(true);
  });

  it("tripCreateManyForJob seeds shipping reference fields onto IMPORT and EXPORT trips", () => {
    const seeds = {
      carrier: "  MAERSK ",
      shipper: "  ACME ",
      vessel: "  VESSEL-X ",
    };

    const importRows = tripCreateManyForJob(
      "t1",
      "j1",
      JobType.IMPORT,
      new Date("2026-03-15"),
      null,
      seeds,
    );
    expect(
      importRows.every((r) =>
        r.carrier === "MAERSK"
        && r.shipper === "ACME"
        && r.vessel === "VESSEL-X"
      ),
    ).toBe(true);

    const exportRows = tripCreateManyForJob(
      "t1",
      "j1",
      JobType.EXPORT,
      new Date("2026-03-15"),
      null,
      seeds,
    );
    expect(
      exportRows.every((r) =>
        r.carrier === "MAERSK"
        && r.shipper === "ACME"
        && r.vessel === "VESSEL-X"
      ),
    ).toBe(true);
  });

  it("LCL completion rule requires POD signature at trip level", () => {
    const lclRule = completionRuleForTemplate(
      JobTripTemplate.PICKUP_TO_DELIVERY,
    ) as any;
    expect(lclRule.tripUploads.requiredUploadTypesExact).toContain(
      TripDocumentType.POD_SIGNATURE,
    );
    expect(lclRule.requireGeneratedDoSigned).toBe(true);
  });

  it("parseQuotationRateLinesFromXlsxBuffer returns empty for invalid buffer", () => {
    expect(parseQuotationRateLinesFromXlsxBuffer(Buffer.from("x"))).toEqual([]);
  });

  it("parses Annex-style XLSX rows into structured rate lines", () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const XLSX = require("xlsx");
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ["ANNEX A"],
      ["A", "SECTION A TITLE"],
      ["1", "Container haulage", "$125.50 per trip"],
      ["2", "Fuel surcharge", "$10.00"],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, "Annex A");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    const lines = parseQuotationRateLinesFromXlsxBuffer(Buffer.from(buf));
    expect(lines.length).toBeGreaterThanOrEqual(2);
    expect(lines[0]).toMatchObject({
      code: "A_1",
      label: "Container haulage",
      description: null,
      unit: null,
      rateCents: 12550,
    });
  });

  it("preserves ambiguous XLSX rate rows for manual amount entry", () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const XLSX = require("xlsx");
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ["ANNEX A"],
      ["E", "SECTION E TITLE"],
      ["1", "Season Parking", "$450 / $500"],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, "Annex A");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    const lines = parseQuotationRateLinesFromXlsxBuffer(Buffer.from(buf));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      code: "E_1",
      description: null,
      rateCents: null,
      requiresManualAmount: true,
      rawRateText: "$450 / $500",
      notes: "$450 / $500",
      isSelectableForJob: true,
    });
  });

  it(
    "parses DOCX Annex tables into structured rate lines",
    async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const AdmZip = require("adm-zip");
    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Annex A</w:t></w:r></w:p>
    <w:p><w:r><w:t>Section B</w:t></w:r></w:p>
    <w:tbl>
      <w:tr>
        <w:tc><w:p><w:r><w:t>Item</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>Description</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>Unit</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>Rate</w:t></w:r></w:p></w:tc>
      </w:tr>
      <w:tr>
        <w:tc><w:p><w:r><w:t>B1</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>Trucking</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>trip</w:t></w:r></w:p></w:tc>
        <w:tc><w:p><w:r><w:t>88.25</w:t></w:r></w:p></w:tc>
      </w:tr>
    </w:tbl>
  </w:body>
</w:document>`;

    const zip = new AdmZip();
    zip.addFile(
      "[Content_Types].xml",
      Buffer.from(
        `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
        "utf8",
      ),
    );
    zip.addFile(
      "_rels/.rels",
      Buffer.from(
        `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
        "utf8",
      ),
    );
    zip.addFile(
      "word/_rels/document.xml.rels",
      Buffer.from(
        `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`,
        "utf8",
      ),
    );
    zip.addFile("word/document.xml", Buffer.from(documentXml, "utf8"));

    const lines = await parseQuotationRateLinesFromDocxBuffer(
      zip.toBuffer() as Buffer,
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      section: "ANNEX A B",
      code: "B1",
      label: "Trucking",
      unit: "trip",
      rateCents: 8825,
      sourceType: "PARSER_ANNEX_DOCX",
    });
  },
  15_000);

  it(
    "returns empty DOCX parsed lines for unstructured content",
    async () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const AdmZip = require("adm-zip");
    const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t>Commercial quotation narrative without table rates.</w:t></w:r></w:p>
  </w:body>
</w:document>`;
    const zip = new AdmZip();
    zip.addFile(
      "[Content_Types].xml",
      Buffer.from(
        `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`,
        "utf8",
      ),
    );
    zip.addFile(
      "_rels/.rels",
      Buffer.from(
        `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`,
        "utf8",
      ),
    );
    zip.addFile("word/document.xml", Buffer.from(documentXml, "utf8"));
    const lines = await parseQuotationRateLinesFromDocxBuffer(
      zip.toBuffer() as Buffer,
    );
    expect(lines).toEqual([]);
  },
  15_000);
});

describe("portal user name", () => {
  it("CreateCustomerCompanyUserDto requires name via class-validator", async () => {
    const { validate } = await import("class-validator");
    const { CreateCustomerCompanyUserDto } = await import(
      "../customers/dto/customers.dto"
    );
    const dto = Object.assign(new CreateCustomerCompanyUserDto(), {
      email: "a@b.com",
      password: "longenough",
    });
    const errors = await validate(dto);
    expect(errors.some((e) => e.property === "name")).toBe(true);
  });
});
