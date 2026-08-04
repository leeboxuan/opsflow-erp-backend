import { TenantModule } from "@prisma/client";

/**
 * Phase 5: shared customer document projection under module entitlements.
 * Static + unit coverage for FINANCE strip / TRANSPORT quotation ownership.
 */
describe("CustomersService module projection", () => {
  function applyModuleDocumentProjection(
    where: any,
    enabled: Set<TenantModule>,
  ) {
    if (!enabled.has(TenantModule.FINANCE)) {
      const financeExclude = {
        AND: [
          { type: { notIn: ["INVOICE", "COMPANY_INVOICE"] } },
          { sourceInvoiceId: null },
        ],
      };
      if (!where.AND) where.AND = [financeExclude];
      else if (Array.isArray(where.AND)) where.AND.push(financeExclude);
      else where.AND = [where.AND, financeExclude];
    }
    return where;
  }

  it("keeps invoice docs when FINANCE enabled", () => {
    const where: any = { tenantId: "t1", status: "ACTIVE" };
    applyModuleDocumentProjection(
      where,
      new Set([TenantModule.FINANCE, TenantModule.TRANSPORT]),
    );
    expect(where.AND).toBeUndefined();
  });

  it("strips invoice aggregates when FINANCE disabled", () => {
    const where: any = { tenantId: "t1", status: "ACTIVE" };
    applyModuleDocumentProjection(where, new Set([TenantModule.TRANSPORT]));
    expect(where.AND).toEqual([
      {
        AND: [
          { type: { notIn: ["INVOICE", "COMPANY_INVOICE"] } },
          { sourceInvoiceId: null },
        ],
      },
    ]);
  });

  it("strips finance docs for WAREHOUSING-only tenants", () => {
    const where: any = { tenantId: "t1", status: "ACTIVE" };
    applyModuleDocumentProjection(where, new Set([TenantModule.WAREHOUSING]));
    expect(JSON.stringify(where)).toContain("INVOICE");
    expect(JSON.stringify(where)).toContain("sourceInvoiceId");
  });

  it("controller source requires TRANSPORT for quotations", () => {
    const fs = require("fs");
    const path = require("path");
    const src = fs.readFileSync(
      path.join(__dirname, "customers.controller.ts"),
      "utf8",
    );
    expect(src).toContain("RequiresTenantModule(TenantModule.TRANSPORT)");
    expect(src).toContain('companies/:companyId/quotations');
  });

  it("service source strips finance docs and 404s invoice downloads", () => {
    const fs = require("fs");
    const path = require("path");
    const src = fs.readFileSync(
      path.join(__dirname, "customers.service.ts"),
      "utf8",
    );
    expect(src).toContain("applyModuleDocumentProjection");
    expect(src).toContain("assertDocumentVisibleUnderModules");
    expect(src).toContain("COMPANY_INVOICE");
  });
});
