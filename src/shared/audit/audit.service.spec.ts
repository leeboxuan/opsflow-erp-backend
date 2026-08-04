import { AuditService } from "./audit.service";
import {
  AUTH_MODE,
  REQUEST_CONTEXT_KIND,
  buildRequestContext,
} from "../auth/request-context";

describe("AuditService platform actor enrichment", () => {
  it("tags Platform Admin operating actor in metadata", async () => {
    const create = jest.fn().mockResolvedValue({});
    const svc = new AuditService({
      auditLog: { create },
    } as any);

    const ctx = buildRequestContext({
      userId: "u-pa",
      authUserId: "a-pa",
      email: "pa@x.com",
      role: "SUPERADMIN",
      platformAdminId: "pa-1",
      tenantId: "t1",
      platformTenantOperation: true,
    });

    await svc.log(
      "t1",
      "CANCEL",
      "Job",
      "job-1",
      { note: "x" },
      "u-pa",
      { requestContext: ctx },
    );

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        tenantId: "t1",
        actorUserId: "u-pa",
        metadata: expect.objectContaining({
          actorType: "PLATFORM_ADMIN",
          platformAdminId: "pa-1",
          authMode: AUTH_MODE.PLATFORM_TENANT_OPERATION,
        }),
      }),
    });
    expect(ctx.kind).toBe(REQUEST_CONTEXT_KIND.PLATFORM_ADMIN);
  });
});
