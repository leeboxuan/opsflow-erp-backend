import type {
  JobMessageImportParsedJobMessage,
  JobMessageParser,
  ParseJobMessageInput,
  ParseJobMessageResult,
} from "./job-message-parser";

const PARSER_VERSION = "fake.fixture.v1";
const EMPTY_META = {
  modelName: null,
  usage: null,
  providerRequestId: null,
} as const;

/**
 * Deterministic parser for tests.
 *
 * This is intentionally not a generic production parser.
 * It only needs to support the repo's acceptance/test fixtures.
 */
export class FakeJobMessageParser implements JobMessageParser {
  getParserVersion(): string {
    return PARSER_VERSION;
  }

  getModelName(): string | null {
    return null;
  }

  async parse(input: ParseJobMessageInput): Promise<ParseJobMessageResult> {
    const src = input.sourceText ?? "";

    // Fixture detection (keeps tests deterministic without calling OpenAI).
    const isFixture = src.includes("GESU6311344") || src.includes("ONE HANNOVER");
    if (!isFixture) {
      return {
        message: {
          parserVersion: PARSER_VERSION,
          batchWarnings: [
            {
              code: "FAKE_PARSER_NO_MATCH",
              field: null,
              message: "Deterministic fake parser has no fixture match.",
              severity: "WARNING",
            },
          ],
          drafts: [],
        },
        meta: EMPTY_META,
      };
    }

    const baseField = (field: string, sourceText: string) => ({
      field,
      sourceText,
      confidence: "HIGH" as const,
    });

    const mkDraft = (d: JobMessageImportParsedJobMessage["drafts"][number]) => d;

    const drafts: JobMessageImportParsedJobMessage["drafts"] = [
      mkDraft({
        clientDraftId: "col-1",
        movementType: "COLLECTION",
        customerNameText: null,
        earliestAt: null,
        latestAt: null,
        timingText: null,
        pickup: { rawText: "EK 30 pioneer sector 2" },
        delivery: { rawText: "Chasen whse. 16/18 jln besut" },
        carrier: "ocean",
        shipper: "nippon",
        vessel: "ONE HANNOVER",
        voyage: "101W",
        containerSizeType: "20FR",
        items: [
          {
            containerNumber: "ONEYSING45428400",
            sealNumber: null,
            referenceNumber: null,
            quantity: 1,
          },
        ],
        picName: "Shuman",
        picPhone: "96440435",
        instructions: [],
        notes: null,
        sourceFragment:
          "COL\n1) 1x20FR pick up ref - ONEYSING45428400\ncarrier: ocean\nshipper: nippon\nvessel: ONE HANNOVER / 101W\nfrom - EK 30 pioneer sector 2\nto - Chasen whse. 16/18 jln besut\nPIC: Shuman 96440435",
        fieldEvidence: [
          baseField("carrier", "carrier: ocean"),
          baseField("shipper", "shipper: nippon"),
          baseField("vessel", "vessel: ONE HANNOVER / 101W"),
          baseField("voyage", "/ 101W"),
          baseField("pickup", "from - EK 30 pioneer sector 2"),
          baseField("delivery", "to - Chasen whse. 16/18 jln besut"),
          baseField("picName", "PIC: Shuman 96440435"),
          baseField("picPhone", "PIC: Shuman 96440435"),
        ],
        warnings: [],
      }),

      // IMP draft #1 (tuas -> db whse)
      mkDraft({
        clientDraftId: "imp-1",
        movementType: "IMPORT",
        customerNameText: null,
        earliestAt: null,
        latestAt: null,
        timingText: null,
        pickup: { rawText: "tuas" },
        delivery: { rawText: "db whse" },
        carrier: null,
        shipper: null,
        vessel: null,
        voyage: null,
        containerSizeType: null,
        items: [
          {
            containerNumber: "GESU6311344",
            sealNumber: "FJ28581743",
            referenceNumber: null,
            quantity: null,
          },
        ],
        picName: null,
        picPhone: null,
        instructions: [],
        notes: null,
        sourceFragment:
          "IMP\n1) GESU6311344 / FJ28581743 (chukong) - PSA 04/08\nfrom - tuas\nto - db whse",
        fieldEvidence: [
          baseField("containerNumber", "GESU6311344"),
          baseField("sealNumber", "FJ28581743"),
          baseField("pickup", "from - tuas"),
          baseField("delivery", "to - db whse"),
        ],
        warnings: [
          {
            code: "PSA_UNRESOLVED",
            field: "delivery",
            message:
              "PSA appears as text only; deterministic location resolution was not applied.",
            severity: "WARNING",
          },
        ],
      }),

      // IMP draft #2 (ppz -> 31 jurong port road)
      mkDraft({
        clientDraftId: "imp-2",
        movementType: "IMPORT",
        customerNameText: null,
        earliestAt: null,
        latestAt: null,
        timingText: "03/08@2300",
        pickup: { rawText: "ppz" },
        delivery: { rawText: "31 jurong port road #08-25/26" },
        carrier: null,
        shipper: null,
        vessel: null,
        voyage: null,
        containerSizeType: null,
        items: [
          {
            containerNumber: "EGSU2183885",
            sealNumber: "EMCDDC0685",
            referenceNumber: null,
            quantity: null,
          },
          {
            containerNumber: "EITU3202879",
            sealNumber: "EMCDDC0655",
            referenceNumber: null,
            quantity: null,
          },
        ],
        picName: null,
        picPhone: null,
        instructions: [],
        notes: null,
        sourceFragment:
          "PSA 03/08@2300\nEGSU2183885 / EMCDDC0685\nEITU3202879 / EMCDDC0655\nfrom - ppz\nto - 31 jurong port road #08-25/26",
        fieldEvidence: [
          baseField("pickup", "from - ppz"),
          baseField("delivery", "to - 31 jurong port road"),
          baseField("timingText", "03/08@2300"),
        ],
        warnings: [],
      }),

      // IMP draft #3 (ppz -> db whse) with timing TBC warning
      mkDraft({
        clientDraftId: "imp-3",
        movementType: "IMPORT",
        customerNameText: null,
        earliestAt: null,
        latestAt: null,
        timingText: "timing TBC",
        pickup: { rawText: "ppz" },
        delivery: { rawText: "db whse" },
        carrier: null,
        shipper: null,
        vessel: null,
        voyage: null,
        containerSizeType: null,
        items: [
          {
            containerNumber: "FFAU6865771",
            sealNumber: "CNDZ03310",
            referenceNumber: null,
            quantity: null,
          },
        ],
        picName: null,
        picPhone: null,
        instructions: ["wait carrier reply"],
        notes: "dem 03/08 timing TBC, wait carrier reply",
        sourceFragment:
          "3) FFAU6865771 / CNDZ03310 (chukong)\ndem 03/08 timing TBC, wait carrier reply\nfrom - ppz\nto - db whse",
        fieldEvidence: [
          baseField("containerNumber", "FFAU6865771"),
          baseField("referenceNumber", "CNDZ03310"),
          baseField("timingText", "timing TBC"),
        ],
        warnings: [
          {
            code: "AMBIGUOUS_TIMING_TBC",
            field: "timing",
            message: "Timing is explicitly TBC; no time was invented.",
            severity: "WARNING",
          },
        ],
      }),

      // EXP draft
      mkDraft({
        clientDraftId: "exp-1",
        movementType: "EXPORT",
        customerNameText: null,
        earliestAt: null,
        latestAt: null,
        timingText: "morning asap",
        pickup: { rawText: "LD at 20 Gul way #05-04" },
        delivery: { rawText: "out 03/08 morning asap" },
        carrier: null,
        shipper: null,
        vessel: null,
        voyage: null,
        containerSizeType: null,
        items: [
          { containerNumber: "MSMU6854235", sealNumber: "FX47120380", referenceNumber: null, quantity: null },
          { containerNumber: "MSMU6568329", sealNumber: "FX47120361", referenceNumber: null, quantity: null },
          { containerNumber: "MSMU7217777", sealNumber: "FX47120253", referenceNumber: null, quantity: null },
        ],
        picName: null,
        picPhone: null,
        instructions: [],
        notes: null,
        sourceFragment:
          "EXP\n1) ETA 04/08@0330 - LD at 20 Gul way #05-04\n(out 03/08 morning asap)\nMSMU6854235 / FX47120380\nMSMU6568329 / FX47120361\nMSMU7217777 / FX47120253",
        fieldEvidence: [baseField("timingText", "morning asap")],
        warnings: [],
      }),

      // LCL draft
      mkDraft({
        clientDraftId: "lcl-1",
        movementType: "LCL",
        customerNameText: null,
        earliestAt: null,
        latestAt: null,
        timingText: "platform - 1pm reach DB",
        pickup: { rawText: "db" },
        delivery: { rawText: "Micron, 1 north coast drive" },
        carrier: null,
        shipper: null,
        vessel: null,
        voyage: null,
        containerSizeType: null,
        items: [
          { containerNumber: null, sealNumber: null, referenceNumber: "platform", quantity: 1 },
        ],
        picName: "Mr Li",
        picPhone: "80396069",
        instructions: ["b4 reach call PIC, he will standby come out assist"],
        notes: null,
        sourceFragment:
          "LCL\n1) platform - 1pm reach DB\nfrom - db\nto - Micron, 1 north coast drive\nPIC: Mr Li 80396069\n(b4 reach call PIC, he will standby come out assist)",
        fieldEvidence: [
          baseField("picName", "PIC: Mr Li 80396069"),
          baseField("picPhone", "80396069"),
          baseField("instructions", "b4 reach call PIC"),
        ],
        warnings: [],
      }),
    ];

    return {
      message: {
        parserVersion: PARSER_VERSION,
        batchWarnings: [],
        drafts,
      },
      meta: EMPTY_META,
    };
  }
}

