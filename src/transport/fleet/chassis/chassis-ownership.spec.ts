import { BadRequestException } from "@nestjs/common";
import {
  chassisOwnershipLabel,
  normalizeChassisOwnership,
  resolveChassisOwnershipPatch,
} from "./chassis-ownership";

describe("chassis ownership", () => {
  it("defaults company-owned chassis with null company", () => {
    expect(normalizeChassisOwnership({})).toEqual({
      isBorrowed: false,
      borrowedFromCompany: null,
    });
    expect(normalizeChassisOwnership({ isBorrowed: false, borrowedFromCompany: "X" })).toEqual({
      isBorrowed: false,
      borrowedFromCompany: null,
    });
  });

  it("requires lending company when borrowed", () => {
    expect(() =>
      normalizeChassisOwnership({ isBorrowed: true, borrowedFromCompany: "  " }),
    ).toThrow(BadRequestException);
    expect(
      normalizeChassisOwnership({ isBorrowed: true, borrowedFromCompany: "  Acme Logistics  " }),
    ).toEqual({
      isBorrowed: true,
      borrowedFromCompany: "Acme Logistics",
    });
  });

  it("clearing borrowed clears company value", () => {
    expect(
      resolveChassisOwnershipPatch(
        { isBorrowed: true, borrowedFromCompany: "Acme" },
        { isBorrowed: false },
      ),
    ).toEqual({ isBorrowed: false, borrowedFromCompany: null });
  });

  it("labels ownership for list/details", () => {
    expect(chassisOwnershipLabel({ isBorrowed: false, borrowedFromCompany: null })).toBe(
      "Company-owned",
    );
    expect(
      chassisOwnershipLabel({ isBorrowed: true, borrowedFromCompany: "Acme Logistics" }),
    ).toBe("Borrowed · Acme Logistics");
  });
});
