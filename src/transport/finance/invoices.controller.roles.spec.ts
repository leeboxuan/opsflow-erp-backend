import { RequestMethod } from "@nestjs/common";
import {
  GUARDS_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
} from "@nestjs/common/constants";
import { Reflector } from "@nestjs/core";
import { Role, TenantModule } from "@prisma/client";
import { AuthGuard } from "../../shared/auth/guards/auth.guard";
import { DestructiveActionGuard } from "../../shared/auth/guards/destructive-action.guard";
import {
  ModuleEntitlementGuard,
  REQUIRES_TENANT_MODULE_KEY,
} from "../../shared/auth/guards/module-entitlement.guard";
import { RoleGuard } from "../../shared/auth/guards/role.guard";
import { TenantGuard } from "../../shared/auth/guards/tenant.guard";
import { InvoicesController } from "./invoices.controller";

const OFFICE_INVOICE_READ_ROLES = [
  Role.ADMIN,
  Role.TRANSPORT_STAFF,
  Role.FINANCE,
  Role.CUSTOMER,
] as const;

const OFFICE_INVOICE_WRITE_ROLES = [
  Role.ADMIN,
  Role.TRANSPORT_STAFF,
  Role.FINANCE,
] as const;

const PAID_ROLES = [Role.ADMIN, Role.FINANCE] as const;

describe("InvoicesController Finance RBAC", () => {
  const reflector = new Reflector();

  function handlerRoles(method: keyof InvoicesController): Role[] {
    return (
      reflector.getAllAndOverride<Role[]>("roles", [
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

  it("lets FINANCE list, get, create, issue, and generate invoices", () => {
    expect(handlerRoles("list")).toEqual([...OFFICE_INVOICE_READ_ROLES]);
    expect(handlerRoles("get")).toEqual([...OFFICE_INVOICE_READ_ROLES]);
    expect(handlerRoles("create")).toEqual([...OFFICE_INVOICE_WRITE_ROLES]);
    expect(handlerRoles("createDraft")).toEqual([...OFFICE_INVOICE_WRITE_ROLES]);
    expect(handlerRoles("draftFromJobs")).toEqual([...OFFICE_INVOICE_WRITE_ROLES]);
    expect(handlerRoles("updateDraft")).toEqual([...OFFICE_INVOICE_WRITE_ROLES]);
    expect(handlerRoles("patchDraft")).toEqual([...OFFICE_INVOICE_WRITE_ROLES]);
    expect(handlerRoles("issue")).toEqual([...OFFICE_INVOICE_WRITE_ROLES]);
    expect(handlerRoles("generate")).toEqual([...OFFICE_INVOICE_WRITE_ROLES]);
    expect(handlerRoles("uploadPdf")).toEqual([...OFFICE_INVOICE_WRITE_ROLES]);
    expect(handlerRoles("getDownloadUrl")).toEqual([...OFFICE_INVOICE_READ_ROLES]);
    expect(handlerRoles("voidInvoice")).toEqual([...OFFICE_INVOICE_WRITE_ROLES]);
    expect(handlerRoles("revertToDraft")).toEqual([...OFFICE_INVOICE_WRITE_ROLES]);
    for (const method of [
      "create",
      "createDraft",
      "issue",
      "generate",
      "markPaid",
    ] as const) {
      expect(handlerRoles(method)).not.toContain(Role.CUSTOMER);
      expect(handlerRoles(method)).toContain(Role.FINANCE);
    }
  });

  it("keeps Mark Paid as Admin or Finance only", () => {
    expect(handlerRoles("markPaid")).toEqual([...PAID_ROLES]);
    expect(handlerRoles("markPaid")).not.toContain(Role.TRANSPORT_STAFF);
    expect(handlerRoles("markPaid")).not.toContain(Role.CUSTOMER);
    expect(handlerRoles("markPaid")).not.toContain(Role.DRIVER);
  });

  it("does not grant DRIVER invoice access", () => {
    for (const method of [
      "list",
      "get",
      "createDraft",
      "issue",
      "markPaid",
    ] as const) {
      expect(handlerRoles(method)).not.toContain(Role.DRIVER);
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
