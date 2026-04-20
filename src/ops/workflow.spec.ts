import { JobTripTemplate, JobType, TripDocumentType } from "@prisma/client";
import {
  completionRuleForTemplate,
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
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].jobSequence).toBe(1);
    expect(rows[1].jobSequence).toBe(2);
    expect(rows[0].jobTripTemplate).toBe(JobTripTemplate.PICKUP_TO_DELIVERY);
    expect(rows[0].completionRuleJson).toEqual({
      requireGeneratedDoSigned: true,
      tripUploads: {
        minUploadCount: 1,
        allowedUploadTypes: [TripDocumentType.PICKUP_DO, TripDocumentType.OFFLOADING],
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
    expect(rows[0].status).toBe("Draft");
    expect(rows[1].status).toBe("Draft");
  });

  it("tripCreateManyForJob creates two EXPORT legs", () => {
    const rows = tripCreateManyForJob(
      "t1",
      "j1",
      JobType.EXPORT,
      new Date("2026-03-15"),
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].jobTripTemplate).toBe(JobTripTemplate.DEPOT_TO_DELIVERY);
    expect(rows[0].completionRuleJson).toEqual({
      requireGeneratedDoSigned: true,
      tripUploads: {
        minUploadCount: 2,
        allowedUploadTypes: [TripDocumentType.PICKUP_DO, TripDocumentType.OFFLOADING],
        requiredUploadTypesExact: [TripDocumentType.PICKUP_DO, TripDocumentType.OFFLOADING],
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
    expect(rows[0].status).toBe("Draft");
    expect(rows[1].status).toBe("Draft");
  });

  it("tripCreateManyForJob creates one LCL leg with expected completion rule", () => {
    const rows = tripCreateManyForJob(
      "t1",
      "j1",
      JobType.LCL,
      new Date("2026-03-15"),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].jobTripTemplate).toBe(JobTripTemplate.PICKUP_TO_DELIVERY);
    expect(rows[0].completionRuleJson).toEqual({
      requireGeneratedDoSigned: true,
      tripUploads: {
        minUploadCount: 1,
        allowedUploadTypes: [TripDocumentType.PICKUP_DO, TripDocumentType.OFFLOADING],
      },
    });
    expect(rows[0].status).toBe("Draft");
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
    expect(completionRuleForTemplate(JobTripTemplate.CUSTOM)).toEqual(
      TRIP_COMPLETION_RULES[JobTripTemplate.CUSTOM],
    );
  });

  it("parseQuotationRateLinesFromXlsxBuffer returns empty for invalid buffer", () => {
    expect(parseQuotationRateLinesFromXlsxBuffer(Buffer.from("x"))).toEqual([]);
  });

  it("parses Annex-style XLSX rows into structured rate lines", () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const XLSX = require("xlsx");
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ["Annex A"],
      ["Section A"],
      ["A1", "Container haulage", "trip", "125.50"],
      ["A2", "Fuel surcharge", "trip", 10],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, "Annex A");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    const lines = parseQuotationRateLinesFromXlsxBuffer(Buffer.from(buf));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      code: "A1",
      label: "A1",
      description: "Container haulage",
      unit: "trip",
      rateCents: 12550,
    });
  });

  it("preserves ambiguous XLSX rate rows for manual amount entry", () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const XLSX = require("xlsx");
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([
      ["Annex A"],
      ["Section E"],
      ["E1", "Season Parking", "month", "$450 / $500"],
    ]);
    XLSX.utils.book_append_sheet(wb, ws, "Annex A");
    const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });

    const lines = parseQuotationRateLinesFromXlsxBuffer(Buffer.from(buf));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      code: "E1",
      description: "Season Parking",
      rateCents: null,
      requiresManualAmount: true,
      rawRateText: "$450 / $500",
      notes: "$450 / $500",
      isSelectableForJob: true,
    });
  });

  it("parses DOCX Annex tables into structured rate lines", async () => {
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
  });

  it("returns empty DOCX parsed lines for unstructured content", async () => {
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
  });
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
