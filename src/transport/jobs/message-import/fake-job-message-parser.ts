import type {
  JobMessageImportParsedJobMessage,
  JobMessageParser,
  ParseJobMessageInput,
  ParseJobMessageResult,
} from "./job-message-parser";
import { FAKE_JOB_MESSAGE_PARSER_VERSION } from "./job-message-import.constants";
import { normalizeSourceTextForTraceability } from "./job-message-import.source-fidelity";

const PARSER_VERSION = FAKE_JOB_MESSAGE_PARSER_VERSION;
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
    const fixtureId = input.testFixtureId?.trim() || null;

    const baseField = (field: string, sourceText: string) => ({
      field,
      sourceText,
      confidence: "HIGH" as const,
    });

    const mkDraft = (d: JobMessageImportParsedJobMessage["drafts"][number]) => d;

    if (fixtureId === "six-draft-ops") {
      return this.parseSixDraftOpsFixture(src, baseField, mkDraft);
    }

    // Existing acceptance fixture (keeps tests deterministic without calling OpenAI).
    const isAcceptanceFixture =
      fixtureId === "acceptance-three-job" ||
      src.includes("GESU6311344") ||
      src.includes("ONE HANNOVER");
    if (!isAcceptanceFixture) {
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
          "IMP\n1) GESU6311344 / FJ28581743\nfrom - tuas\nto - db whse",
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

    const normalizedSource = normalizeSourceTextForTraceability(src);
    const traceableDrafts = drafts.filter((draft) =>
      normalizedSource.includes(normalizeSourceTextForTraceability(draft.sourceFragment)),
    );

    return {
      message: {
        parserVersion: PARSER_VERSION,
        batchWarnings: traceableDrafts.length === drafts.length ? [] : [
          {
            code: "FAKE_PARSER_PARTIAL_FIXTURE",
            field: null,
            message:
              "Deterministic fake parser omitted fixture drafts whose source fragments were absent from the submitted text.",
            severity: "WARNING",
          },
        ],
        drafts: traceableDrafts,
      },
      meta: EMPTY_META,
    };
  }

  private parseSixDraftOpsFixture(
    src: string,
    baseField: (field: string, sourceText: string) => {
      field: string;
      sourceText: string;
      confidence: "HIGH";
    },
    mkDraft: (
      d: JobMessageImportParsedJobMessage["drafts"][number],
    ) => JobMessageImportParsedJobMessage["drafts"][number],
  ): ParseJobMessageResult {
    const drafts: JobMessageImportParsedJobMessage["drafts"] = [
      mkDraft({
        clientDraftId: "col-1",
        movementType: "COLLECTION",
        customerNameText: null,
        earliestAt: null,
        latestAt: null,
        timingText: null,
        pickup: { rawText: "EK 30 pioneer sector 2" },
        delivery: { rawText: "HOCK CHUAN. 31 JURONG PORT ROAD #07-20" },
        carrier: "samudera",
        shipper: "ESL",
        vessel: "ALS SUMIRE",
        voyage: "249N",
        containerSizeType: "40HC",
        items: [
          {
            containerNumber: null,
            sealNumber: null,
            referenceNumber: "SGBKKCAE9294",
            quantity: 1,
          },
        ],
        picName: null,
        picPhone: null,
        instructions: [],
        notes: null,
        sourceFragment: "SGBKKCAE9294",
        fieldEvidence: [
          baseField("containerSizeType", "1x40HC"),
          baseField("referenceNumber", "SGBKKCAE9294"),
        ],
        warnings: [],
      }),
      mkDraft({
        clientDraftId: "imp-1",
        movementType: "IMPORT",
        customerNameText: null,
        earliestAt: null,
        latestAt: null,
        timingText: null,
        pickup: { rawText: "ppz" },
        delivery: { rawText: "db whse" },
        carrier: null,
        shipper: null,
        vessel: null,
        voyage: null,
        containerSizeType: null,
        items: [
          { containerNumber: "OOCU9212980", sealNumber: "OOLKYV1084", referenceNumber: "IG6H183388Z", quantity: 1 },
          { containerNumber: "CSNU7730628", sealNumber: "OOLKYR8671", referenceNumber: "IG6H183388Z", quantity: 1 },
          { containerNumber: "FFAU2879099", sealNumber: "OOLKYS0580", referenceNumber: "IG6H183388Z", quantity: 1 },
        ],
        picName: null,
        picPhone: null,
        instructions: [],
        notes: "permit - IG6H183388Z (chukong)",
        sourceFragment: "OOCU9212980 / OOLKYV1084",
        fieldEvidence: [baseField("pickup", "from - ppz"), baseField("delivery", "to - db whse")],
        warnings: [],
      }),
      mkDraft({
        clientDraftId: "exp-1",
        movementType: "EXPORT",
        customerNameText: null,
        earliestAt: null,
        latestAt: null,
        timingText: "ETA 05/09@1030",
        pickup: { rawText: "db whse" },
        delivery: { rawText: "db whse" },
        carrier: null,
        shipper: null,
        vessel: null,
        voyage: null,
        containerSizeType: null,
        items: [
          { containerNumber: "MSBU3879600", sealNumber: "FX47126059", referenceNumber: null, quantity: 1 },
        ],
        picName: null,
        picPhone: null,
        instructions: ["LD at db whse"],
        notes: null,
        sourceFragment: "MSBU3879600 / FX47126059",
        fieldEvidence: [baseField("containerNumber", "MSBU3879600")],
        warnings: [],
      }),
      mkDraft({
        clientDraftId: "ret-1",
        movementType: "RETURN",
        customerNameText: null,
        earliestAt: null,
        latestAt: null,
        timingText: "det 04/09",
        pickup: { rawText: "db whse" },
        delivery: { rawText: "cogent" },
        carrier: null,
        shipper: null,
        vessel: null,
        voyage: null,
        containerSizeType: null,
        items: [
          { containerNumber: "UASU1061210", sealNumber: null, referenceNumber: null, quantity: 1 },
        ],
        picName: null,
        picPhone: null,
        instructions: [],
        notes: null,
        sourceFragment: "UASU1061210 - det 04/09",
        fieldEvidence: [baseField("pickup", "from - db whse"), baseField("delivery", "to - cogent")],
        warnings: [],
      }),
      mkDraft({
        clientDraftId: "ret-2",
        movementType: "RETURN",
        customerNameText: null,
        earliestAt: null,
        latestAt: null,
        timingText: "det tba",
        pickup: { rawText: "db whse" },
        delivery: { rawText: "TBA (wait carrier update return to HLA or tuas)" },
        carrier: null,
        shipper: null,
        vessel: null,
        voyage: null,
        containerSizeType: null,
        items: [
          { containerNumber: "MSDU7515916", sealNumber: null, referenceNumber: null, quantity: 1 },
        ],
        picName: null,
        picPhone: null,
        instructions: [],
        notes: "det tba",
        sourceFragment: "MSDU7515916 - det tba",
        fieldEvidence: [baseField("delivery", "to - TBA")],
        warnings: [
          {
            code: "UNRESOLVED_DEPOT",
            field: "delivery",
            message: "Return depot is TBA; location left unresolved.",
            severity: "WARNING",
          },
        ],
      }),
      mkDraft({
        clientDraftId: "lcl-1",
        movementType: "LCL",
        customerNameText: null,
        earliestAt: null,
        latestAt: null,
        timingText: "morning 830 reach DB",
        pickup: { rawText: "db whse" },
        delivery: { rawText: "AMS whse. 15 tuas ave 18" },
        carrier: null,
        shipper: null,
        vessel: null,
        voyage: null,
        containerSizeType: null,
        items: [
          { containerNumber: null, sealNumber: null, referenceNumber: "platform", quantity: 1 },
        ],
        picName: "Mr Venka",
        picPhone: null,
        instructions: ["take documents from Ah Fu"],
        notes: null,
        sourceFragment: "PIC: Mr Venka 15 tuas avenue 18",
        fieldEvidence: [baseField("picName", "PIC: Mr Venka")],
        warnings: [],
      }),
    ];

    const normalizedSource = normalizeSourceTextForTraceability(src);
    const traceableDrafts = drafts.filter((draft) =>
      normalizedSource.includes(normalizeSourceTextForTraceability(draft.sourceFragment)),
    );

    return {
      message: {
        parserVersion: PARSER_VERSION,
        batchWarnings:
          traceableDrafts.length === 6
            ? []
            : [
                {
                  code: "FAKE_PARSER_PARTIAL_FIXTURE",
                  field: null,
                  message:
                    "Deterministic fake parser omitted fixture drafts whose source fragments were absent from the submitted text.",
                  severity: "WARNING",
                },
              ],
        drafts: traceableDrafts,
      },
      meta: EMPTY_META,
    };
  }
}

