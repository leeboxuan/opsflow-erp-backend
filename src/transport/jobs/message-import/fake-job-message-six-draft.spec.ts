import { FakeJobMessageParser } from "./fake-job-message-parser";
import { resolveImportedLocation } from "./job-message-import.location-verification";

export const SIX_DRAFT_OPS_FIXTURE = `04/09 JOB

Col
1)1x40HC
pick up ref - SGBKKCAE9294
carrier: samudera // shipper: ESL
vessel: ALS SUMIRE / 249N
from - EK 30 pioneer sector 2
to - HOCK CHUAN. 31 JURONG PORT ROAD #07-20

IMP

1. permit - IG6H183388Z (chukong)
   OOCU9212980 / OOLKYV1084
   CSNU7730628 / OOLKYR8671
   FFAU2879099 / OOLKYS0580
   from - ppz
   to - db whse

EXP

1. MSBU3879600 / FX47126059 - ETA 05/09@1030
   LD at db whse

Return

1. UASU1061210 - det 04/09
   from - db whse
   to - cogent

2. MSDU7515916 - det tba
   from - db whse
   to - TBA (wait carrier update return to HLA or tuas)

LCL - morning 830 reach DB
1)platform - 1 trip (take documents from Ah Fu)
from - db whse
to - AMS whse. 15 tuas ave 18. PIC: Mr Venka 15 tuas avenue 18
`;

describe("Fake parser six-draft fixture (mapping/review only — not live OpenAI)", () => {
  const parser = new FakeJobMessageParser();

  it("extracts exactly six reviewable drafts from the required sample", async () => {
    const result = await parser.parse({
      tenantId: "t1",
      timezone: "Asia/Singapore",
      sourceChannel: "WHATSAPP",
      sourceText: SIX_DRAFT_OPS_FIXTURE,
      testFixtureId: "six-draft-ops",
    });
    expect(result.message.drafts).toHaveLength(6);
    expect(result.message.drafts.map((d) => d.movementType)).toEqual([
      "COLLECTION",
      "IMPORT",
      "EXPORT",
      "RETURN",
      "RETURN",
      "LCL",
    ]);
    const collection = result.message.drafts[0]!;
    expect(collection.items[0]?.containerNumber).toBeNull();
    expect(collection.containerSizeType).toBe("40HC");
    expect(collection.items[0]?.quantity).toBe(1);
    expect(collection.items[0]?.referenceNumber).toBe("SGBKKCAE9294");
    expect(result.message.drafts[1]!.items).toHaveLength(3);
    const tbaReturn = result.message.drafts[4]!;
    expect(tbaReturn.delivery.rawText).toMatch(/TBA/i);
    const unresolved = resolveImportedLocation({ rawText: tbaReturn.delivery.rawText });
    expect(unresolved.verificationStatus).toBe("UNRESOLVED");
    expect(unresolved.postal).toBeNull();
  });

  it("does not invent container identity or postal codes for aliases", async () => {
    const result = await parser.parse({
      tenantId: "t1",
      timezone: "Asia/Singapore",
      sourceChannel: "WHATSAPP",
      sourceText: SIX_DRAFT_OPS_FIXTURE,
      testFixtureId: "six-draft-ops",
    });
    const imp = result.message.drafts[1]!;
    expect(resolveImportedLocation({ rawText: imp.pickup.rawText }).postal).toBeNull();
    expect(resolveImportedLocation({ rawText: "db whse" }).verificationStatus).toBe(
      "NEEDS_REVIEW",
    );
  });

  it("adversarial reordering still requires unique fixture tokens (no live AI)", async () => {
    const reordered = `
COLLECTION pickup ref SGBKKCAE9294 1x40HC ALS SUMIRE
IMPORT OOCU9212980 / OOLKYV1084
EXPORT MSBU3879600 / FX47126059
RETURN UASU1061210 - det 04/09
RETURN MSDU7515916 - det tba
LCL PIC: Mr Venka 15 tuas avenue 18
`;
    const result = await parser.parse({
      tenantId: "t1",
      timezone: "Asia/Singapore",
      sourceChannel: "WHATSAPP",
      sourceText: reordered,
      testFixtureId: "six-draft-ops",
    });
    expect(result.message.drafts).toHaveLength(6);
  });

  it("still extracts six drafts when headings are abbreviated or missing", async () => {
    const messy = `04/09 JOB ALS SUMIRE
col 1x40HC pickup ref SGBKKCAE9294
imp OOCU9212980 / OOLKYV1084
exp MSBU3879600 / FX47126059
ret UASU1061210 - det 04/09
ret MSDU7515916 - det tba
lcl PIC: Mr Venka 15 tuas avenue 18
`;
    const result = await parser.parse({
      tenantId: "t1",
      timezone: "Asia/Singapore",
      sourceChannel: "WHATSAPP",
      sourceText: messy,
      testFixtureId: "six-draft-ops",
    });
    expect(result.message.drafts).toHaveLength(6);
    expect(result.message.drafts[0]!.items[0]?.containerNumber).toBeNull();
  });

  it("does not treat the ops sample as a fixture without explicit injection", async () => {
    const result = await parser.parse({
      tenantId: "t1",
      timezone: "Asia/Singapore",
      sourceChannel: "WHATSAPP",
      sourceText: SIX_DRAFT_OPS_FIXTURE,
    });
    expect(result.message.drafts).toHaveLength(0);
    expect(result.message.batchWarnings.some((w) => w.code === "FAKE_PARSER_NO_MATCH")).toBe(
      true,
    );
  });

  it("does not invent postal codes for unknown aliases or Google rows without postal", () => {
    expect(resolveImportedLocation({ rawText: "mystery yard xyz" }).postal).toBeNull();
    expect(resolveImportedLocation({ rawText: "mystery yard xyz" }).verificationStatus).toBe(
      "NEEDS_REVIEW",
    );
    const googleNoPostal = resolveImportedLocation({
      rawText: "15 Tuas Avenue 18, Singapore",
      address1: "15 Tuas Avenue 18, Singapore",
      placeId: "ChIJ-no-postal",
      postal: null,
    });
    expect(googleNoPostal.postal).toBeNull();
    expect(googleNoPostal.placeId).toBe("ChIJ-no-postal");
    expect(googleNoPostal.verificationStatus).toBe("NEEDS_REVIEW");
  });
});
