import { Role } from "@prisma/client";
import { PATH_METADATA, METHOD_METADATA } from "@nestjs/common/constants";
import { RequestMethod } from "@nestjs/common/enums/request-method.enum";
import { Reflector } from "@nestjs/core";
import { RoleGuard, Roles } from "../auth/guards/role.guard";
import { RealtimeController } from "./realtime.controller";

describe("RealtimeController", () => {
  it("registers GET /realtime/events (global prefix api → /api/realtime/events)", () => {
    const path = Reflect.getMetadata(PATH_METADATA, RealtimeController);
    expect(path).toBe("realtime");

    const methodPath = Reflect.getMetadata(
      PATH_METADATA,
      RealtimeController.prototype.events,
    );
    expect(methodPath).toBe("events");

    const method = Reflect.getMetadata(
      METHOD_METADATA,
      RealtimeController.prototype.events,
    );
    expect(method).toBe(RequestMethod.GET);
  });

  it("restricts SSE to ADMIN, OPS, FINANCE, DRIVER (not CUSTOMER)", () => {
    const classRoles = Reflect.getMetadata("roles", RealtimeController);
    const handlerRoles = Reflect.getMetadata(
      "roles",
      RealtimeController.prototype.events,
    );
    for (const roles of [classRoles, handlerRoles]) {
      expect(roles).toEqual([
        Role.ADMIN,
        Role.OPS,
        Role.FINANCE,
        Role.DRIVER,
      ]);
      expect(roles).not.toContain(Role.CUSTOMER);
    }
  });
});

describe("RoleGuard + RealtimeController", () => {
  const reflector = new Reflector();
  const guard = new RoleGuard(reflector);

  const ctxForRole = (role: Role) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({ tenant: { tenantId: "tenant-1", role } }),
      }),
      getHandler: () => RealtimeController.prototype.events,
      getClass: () => RealtimeController,
    }) as any;

  it("rejects CUSTOMER before SSE stream opens", () => {
    expect(() => guard.canActivate(ctxForRole(Role.CUSTOMER))).toThrow(
      /Required role/,
    );
  });

  it("allows DRIVER to open SSE stream", () => {
    expect(guard.canActivate(ctxForRole(Role.DRIVER))).toBe(true);
  });
});
