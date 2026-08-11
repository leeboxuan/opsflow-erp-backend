import {
  lineAmountCents,
  lineTaxCents,
  qtyToMillis,
} from "./customer-quotation-money";

describe("customer-quotation-money", () => {
  describe("lineAmountCents", () => {
    it("qty 0.1 * 100 cents = 10", () => {
      expect(lineAmountCents(0.1, 100)).toBe(10);
    });

    it("rejects qty with more than 3 decimal places", () => {
      expect(() => lineAmountCents(0.1234, 100)).toThrow(
        /at most 3 decimal places/,
      );
      expect(() => qtyToMillis(1.0001)).toThrow(/at most 3 decimal places/);
    });

    it("accepts qty with exactly 3 decimal places", () => {
      expect(lineAmountCents(1.125, 1000)).toBe(1125);
    });
  });

  describe("lineTaxCents", () => {
    it("applies 900 bp tax", () => {
      expect(lineTaxCents(10000, 900)).toBe(900);
      expect(lineTaxCents(10, 900)).toBe(1);
    });

    it("returns 0 for zero tax rate", () => {
      expect(lineTaxCents(10000, 0)).toBe(0);
    });
  });

  describe("multiple lines", () => {
    it("sums amounts and tax independently per line", () => {
      const lines = [
        { qty: 0.1, unitPriceCents: 100, taxRateBp: 900 },
        { qty: 2, unitPriceCents: 1000, taxRateBp: 900 },
      ];
      const amounts = lines.map((l) => lineAmountCents(l.qty, l.unitPriceCents));
      const taxes = amounts.map((a, i) => lineTaxCents(a, lines[i].taxRateBp));
      expect(amounts).toEqual([10, 2000]);
      expect(taxes).toEqual([1, 180]);
      expect(amounts.reduce((s, a) => s + a, 0)).toBe(2010);
      expect(taxes.reduce((s, t) => s + t, 0)).toBe(181);
    });
  });
});
