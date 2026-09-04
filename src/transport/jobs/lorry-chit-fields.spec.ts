import { formatLorryChitDateLabel, resolveLorryChitTruckNumber } from "./lorry-chit-fields";

describe("lorry chit field helpers", () => {
  it("prefers the driver's assigned vehicle over the trip-assigned plate", () => {
    expect(
      resolveLorryChitTruckNumber({
        tripFleetPlate: "GBE1234A",
        driverVehiclePlate: "SBA9999Z",
        acceptedVehicleNo: "OLD",
      }),
    ).toBe("SBA9999Z");
  });

  it("falls back to the driver's assigned vehicle when the trip has no plate", () => {
    expect(
      resolveLorryChitTruckNumber({
        tripFleetPlate: null,
        tripVehiclePlate: "  ",
        driverFleetPlate: null,
        driverVehiclePlate: "SBA8888K",
        acceptedVehicleNo: "OLD",
      }),
    ).toBe("SBA8888K");
  });

  it("formats today as DD/MM/YYYY in Asia/Singapore", () => {
    const label = formatLorryChitDateLabel(
      new Date("2026-09-04T02:00:00.000Z"),
      "Asia/Singapore",
    );
    expect(label).toBe("04/09/2026");
  });
});
