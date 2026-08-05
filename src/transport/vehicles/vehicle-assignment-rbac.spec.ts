import { GUARDS_METADATA } from "@nestjs/common/constants";
import { Role } from "@prisma/client";
import { RoleGuard } from "../../shared/auth/guards/role.guard";
import { FleetVehiclesController } from "../fleet/vehicles/fleet-vehicles.controller";
import { VehiclesController } from "./vehicles.controller";

describe("vehicle assignment RBAC", () => {
  it.each([
    ["standard", VehiclesController.prototype.assignDriver],
    ["fleet", FleetVehiclesController.prototype.assignDriver],
  ])("restricts %s vehicle assignment to driver-management roles", (_, handler) => {
    expect(Reflect.getMetadata("roles", handler)).toEqual([
      Role.ADMIN,
      Role.TRANSPORT_STAFF,
    ]);
    expect(Reflect.getMetadata(GUARDS_METADATA, handler)).toContain(RoleGuard);
  });
});
