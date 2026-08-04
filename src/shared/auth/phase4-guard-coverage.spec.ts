/**
 * Phase 4 guard coverage: legacy finance requires TenantGuard + FINANCE module.
 */
import * as fs from "fs";
import * as path from "path";

describe("Phase 4 controller guard inventory", () => {
  const root = path.join(__dirname, "..", "..");

  function read(rel: string) {
    return fs.readFileSync(path.join(root, rel), "utf8");
  }

  it("legacy finance.controller uses TenantGuard + FINANCE module", () => {
    const src = read("transport/finance/finance.controller.ts");
    expect(src).toContain("TenantGuard");
    expect(src).toContain("ModuleEntitlementGuard");
    expect(src).toContain("TenantModule.FINANCE");
  });

  it("transport POD/orders/trips/fleet/drivers/master require TRANSPORT", () => {
    for (const rel of [
      "transport/pod.controller.ts",
      "transport/transport.controller.ts",
      "transport/trip.controller.ts",
      "transport/vehicles/fleet.controller.ts",
      "transport/drivers/drivers.controller.ts",
      "transport/master-rates/master.controller.ts",
    ]) {
      const src = read(rel);
      expect(src).toContain("ModuleEntitlementGuard");
      expect(src).toContain("TenantModule.TRANSPORT");
    }
  });

  it("portal invoices require FINANCE", () => {
    const src = read("transport/finance/portal-invoices.controller.ts");
    expect(src).toContain("TenantModule.FINANCE");
  });
});
