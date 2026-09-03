import { BadRequestException } from "@nestjs/common";
import { ContainerSize } from "@prisma/client";
import {
  parseContainerSizeInput,
  toContainerSizeWire,
} from "./container-size";
import {
  parseValidJobItemsFromInput,
  parseValidUpdateJobItemsFromInput,
} from "./create-job-validation.helpers";
import { JobType } from "@prisma/client";

describe("container size wire helpers", () => {
  it("round-trips supported wire values", () => {
    expect(toContainerSizeWire(ContainerSize.FT_20)).toBe("20ft");
    expect(toContainerSizeWire(ContainerSize.FT_40)).toBe("40ft");
    expect(toContainerSizeWire(ContainerSize.FT_45)).toBe("45ft");
    expect(parseContainerSizeInput("20ft")).toBe(ContainerSize.FT_20);
    expect(parseContainerSizeInput("40ft")).toBe(ContainerSize.FT_40);
    expect(parseContainerSizeInput("45ft")).toBe(ContainerSize.FT_45);
  });

  it("keeps null for legacy empty values", () => {
    expect(parseContainerSizeInput(null)).toBeNull();
    expect(parseContainerSizeInput("")).toBeNull();
    expect(toContainerSizeWire(null)).toBeNull();
  });

  it("rejects unsupported sizes", () => {
    expect(() => parseContainerSizeInput("40HC")).toThrow(BadRequestException);
    expect(() => parseContainerSizeInput("20")).toThrow(/20ft, 40ft, 45ft/);
  });
});

describe("parseValidJobItemsFromInput containerSize", () => {
  it("allows null size when not required (legacy load / soft parse)", () => {
    const rows = parseValidJobItemsFromInput(
      [{ containerNumber: "TGHU1", sealNo: "S1" }],
      JobType.IMPORT,
    );
    expect(rows).toEqual([
      expect.objectContaining({
        itemCode: "TGHU1",
        sealNo: "S1",
        containerSize: null,
      }),
    ]);
  });

  it("requires size for new container create rows", () => {
    expect(() =>
      parseValidJobItemsFromInput(
        [{ containerNumber: "TGHU1" }],
        JobType.IMPORT,
        undefined,
        { requireContainerSize: true },
      ),
    ).toThrow(/Container size is required/);
  });

  it("accepts all three sizes independently per row", () => {
    const rows = parseValidJobItemsFromInput(
      [
        { containerNumber: "A", containerSize: "20ft" },
        { containerNumber: "B", containerSize: "40ft" },
        { containerNumber: "C", containerSize: "45ft" },
      ],
      JobType.EXPORT,
      undefined,
      { requireContainerSize: true },
    );
    expect(rows.map((r) => r.containerSize)).toEqual([
      ContainerSize.FT_20,
      ContainerSize.FT_40,
      ContainerSize.FT_45,
    ]);
  });

  it("ignores containerSize on LCL rows", () => {
    const rows = parseValidJobItemsFromInput(
      [{ itemCode: "BOX", qty: 2, containerSize: "40ft" }],
      JobType.LCL,
      undefined,
      { requireContainerSize: true },
    );
    expect(rows[0]?.containerSize).toBeNull();
  });

  it("requires size on intentional update payload rows", () => {
    expect(() =>
      parseValidUpdateJobItemsFromInput(
        [{ id: "item-1", containerNumber: "TGHU1", sealNo: "S" }],
        JobType.IMPORT,
      ),
    ).toThrow(/Container size is required/);

    const ok = parseValidUpdateJobItemsFromInput(
      [{ id: "item-1", containerNumber: "TGHU1", containerSize: "40ft" }],
      JobType.IMPORT,
    );
    expect(ok[0]).toEqual(
      expect.objectContaining({
        id: "item-1",
        containerSize: ContainerSize.FT_40,
      }),
    );
  });
});
