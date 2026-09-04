import { parseSingaporeAddress } from "./job-message-import.address-parse";

describe("parseSingaporeAddress", () => {
  it("extracts postal code and unit from a Singapore warehouse address", () => {
    expect(
      parseSingaporeAddress("Chasen Warehouse, 16 Jalan Buroh, Singapore 128578, #01-01"),
    ).toEqual({
      addressLine1: "Chasen Warehouse, 16 Jalan Buroh",
      postalCode: "128578",
      addressLine2: "#01-01",
      unitLevel: "01",
      unitNumber: "01",
    });
  });

  it.each([
    ["21 Tuas Avenue 3, Singapore 639417, #03-02", "639417", "#03-02", "03", "02"],
    ["30 Pioneer Road North, Singapore 628471, #02-05", "628471", "#02-05", "02", "05"],
  ])("parses %j", (raw, postal, line2, level, unit) => {
    const parsed = parseSingaporeAddress(raw);
    expect(parsed.postalCode).toBe(postal);
    expect(parsed.addressLine2).toBe(line2);
    expect(parsed.unitLevel).toBe(level);
    expect(parsed.unitNumber).toBe(unit);
    expect(parsed.addressLine1).not.toMatch(/\d{6}/);
    expect(parsed.addressLine1).not.toMatch(/#\d/);
  });

  it("extracts hash unit without requiring a comma (fixture delivery line)", () => {
    expect(
      parseSingaporeAddress("HOCK CHUAN. 31 JURONG PORT ROAD #07-20"),
    ).toEqual({
      addressLine1: "HOCK CHUAN. 31 JURONG PORT ROAD",
      postalCode: null,
      addressLine2: "#07-20",
      unitLevel: "07",
      unitNumber: "20",
    });
  });

  it("does not invent a unit from Pioneer Sector street numbers", () => {
    const parsed = parseSingaporeAddress("EK 30 pioneer sector 2");
    expect(parsed.addressLine2).toBeNull();
    expect(parsed.unitLevel).toBeNull();
    expect(parsed.unitNumber).toBeNull();
    expect(parsed.addressLine1).toMatch(/sector 2/i);
  });

  it("supports alternate postal and unit formats", () => {
    expect(parseSingaporeAddress("Acme, 1 Road, S128578, Unit 01-01")).toMatchObject({
      postalCode: "128578",
      addressLine2: "#01-01",
    });
    expect(parseSingaporeAddress("Acme, 1 Road, (128578), 01-01")).toMatchObject({
      postalCode: "128578",
      addressLine2: "#01-01",
    });
  });
});
