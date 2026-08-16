import { RequestMethod } from "@nestjs/common";
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from "@nestjs/common/constants";
import { Reflector } from "@nestjs/core";
import { CanonicalTenantRole, TenantModule } from "@prisma/client";
import { AuthGuard } from "../../shared/auth/guards/auth.guard";
import { DestructiveActionGuard } from "../../shared/auth/guards/destructive-action.guard";
import {
  ModuleEntitlementGuard,
  REQUIRES_TENANT_MODULE_KEY,
} from "../../shared/auth/guards/module-entitlement.guard";
import { RoleGuard } from "../../shared/auth/guards/role.guard";
import { TenantGuard } from "../../shared/auth/guards/tenant.guard";
import { InvoicesController } from "./invoices.controller";

const FINANCE_INVOICE_ROLES = [
  CanonicalTenantRole.TENANT_ADMIN,
  CanonicalTenantRole.FINANCE_ADMIN,
] as const;

describe("InvoicesController Finance RBAC", () => {
  const reflector = new Reflector();

  function handlerRoles(method: keyof InvoicesController): string[] {
    return (
      reflector.getAllAndOverride<string[]>("roles", [
        InvoicesController.prototype[method],
        InvoicesController,
      ]) ?? []
    );
  }

  it("requires the Finance module and the full guard stack", () => {
    expect(Reflect.getMetadata(PATH_METADATA, InvoicesController)).toBe(
      "finance/invoices",
    );
    expect(Reflect.getMetadata(GUARDS_METADATA, InvoicesController)).toEqual([
      AuthGuard,
      TenantGuard,
      RoleGuard,
      ModuleEntitlementGuard,
      DestructiveActionGuard,
    ]);
    expect(
      reflector.getAllAndOverride<TenantModule[]>(REQUIRES_TENANT_MODULE_KEY, [
        InvoicesController.prototype.list,
        InvoicesController,
      ]),
    ).toEqual([TenantModule.FINANCE]);
  });

  it("lets TENANT_ADMIN and FINANCE_ADMIN list, get, create, issue, and generate invoices", () => {
    expect(handlerRoles("list")).toEqual([...FINANCE_INVOICE_ROLES]);
    expect(handlerRoles("get")).toEqual([...FINANCE_INVOICE_ROLES]);
    expect(handlerRoles("create")).toEqual([...FINANCE_INVOICE_ROLES]);
    expect(handlerRoles("createDraft")).toEqual([...FINANCE_INVOICE_ROLES]);
    expect(handlerRoles("draftFromJobs")).toEqual([...FINANCE_INVOICE_ROLES]);
    expect(handlerRoles("updateDraft")).toEqual([...FINANCE_INVOICE_ROLES]);
    expect(handlerRoles("patchDraft")).toEqual([...FINANCE_INVOICE_ROLES]);
    expect(handlerRoles("issue")).toEqual([...FINANCE_INVOICE_ROLES]);
    expect(handlerRoles("generate")).toEqual([...FINANCE_INVOICE_ROLES]);
    expect(handlerRoles("uploadPdf")).toEqual([...FINANCE_INVOICE_ROLES]);
    expect(handlerRoles("getDownloadUrl")).toEqual([...FINANCE_INVOICE_ROLES]);
    expect(handlerRoles("voidInvoice")).toEqual([...FINANCE_INVOICE_ROLES]);
    expect(InvoicesController.prototype).not.toHaveProperty("revertToDraft");
    expect(
      Object.getOwnPropertyNames(InvoicesController.prototype).join(" "),
    ).not.toMatch(/revert/i);
    for (const method of [
      "create",
      "createDraft",
      "issue",
      "generate",
      "markPaid",
    ] as const) {
      expect(handlerRoles(method)).not.toContain(CanonicalTenantRole.CUSTOMER_ADMIN);
      expect(handlerRoles(method)).not.toContain(CanonicalTenantRole.TRANSPORT_ADMIN);
      expect(handlerRoles(method)).toContain(CanonicalTenantRole.FINANCE_ADMIN);
    }
  });

  it("keeps Mark Paid as Tenant Admin or Finance Admin only", () => {
    expect(handlerRoles("markPaid")).toEqual([...FINANCE_INVOICE_ROLES]);
    expect(handlerRoles("markPaid")).not.toContain(
      CanonicalTenantRole.TRANSPORT_ADMIN,
    );
    expect(handlerRoles("markPaid")).not.toContain(
      CanonicalTenantRole.CUSTOMER_ADMIN,
    );
    expect(handlerRoles("markPaid")).not.toContain(
      CanonicalTenantRole.TRANSPORT_DRIVER,
    );
  });

  it("does not grant DRIVER or TRANSPORT_ADMIN invoice access", () => {
    for (const method of [
      "list",
      "get",
      "createDraft",
      "issue",
      "markPaid",
    ] as const) {
      expect(handlerRoles(method)).not.toContain(
        CanonicalTenantRole.TRANSPORT_DRIVER,
      );
      expect(handlerRoles(method)).not.toContain(
        CanonicalTenantRole.TRANSPORT_ADMIN,
      );
    }
  });

  it("registers list as GET / and paid as POST :id/paid", () => {
    expect(
      Reflect.getMetadata(METHOD_METADATA, InvoicesController.prototype.list),
    ).toBe(RequestMethod.GET);
    expect(
      Reflect.getMetadata(PATH_METADATA, InvoicesController.prototype.markPaid),
    ).toBe(":id/paid");
    expect(
      Reflect.getMetadata(
        METHOD_METADATA,
        InvoicesController.prototype.markPaid,
      ),
    ).toBe(RequestMethod.POST);
  });
});
