import { CanonicalTenantRole, Role, WarehouseJobType } from '@prisma/client';
import { PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { readFileSync } from 'fs';
import { join } from 'path';
import { RoleGuard } from '../../shared/auth/guards/role.guard';
import { toCanonicalTenantRoles } from '../../shared/auth/canonical-tenant-role';
import { WarehouseJobsController } from './warehouse-jobs.controller';

const controllerPath = join(__dirname, 'warehouse-jobs.controller.ts');
const controllerSource = readFileSync(controllerPath, 'utf8');

const READ_ROLES = [
  CanonicalTenantRole.TENANT_ADMIN,
  CanonicalTenantRole.WAREHOUSE_ADMIN,
  CanonicalTenantRole.WAREHOUSE_STAFF,
];
const MUTATE_ROLES = [
  CanonicalTenantRole.TENANT_ADMIN,
  CanonicalTenantRole.WAREHOUSE_ADMIN,
];
const FLOOR_ROLES = [
  CanonicalTenantRole.TENANT_ADMIN,
  CanonicalTenantRole.WAREHOUSE_ADMIN,
  CanonicalTenantRole.WAREHOUSE_STAFF,
];
const BLOCKED_ROLES = [
  CanonicalTenantRole.TRANSPORT_DRIVER,
  CanonicalTenantRole.CUSTOMER_ADMIN,
  CanonicalTenantRole.FINANCE_ADMIN,
  CanonicalTenantRole.TRANSPORT_ADMIN,
];

function getEffectiveRoles(
  handler: (...args: unknown[]) => unknown,
): CanonicalTenantRole[] {
  const reflector = new Reflector();
  return (
    reflector.getAllAndOverride<CanonicalTenantRole[]>('roles', [
      handler,
      WarehouseJobsController,
    ]) ?? []
  );
}

function ctxForHandler(
  handler: (...args: unknown[]) => unknown,
  role: Role | CanonicalTenantRole,
) {
  const roles = toCanonicalTenantRoles([role]);
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        tenant: { tenantId: 'tenant-1', role, roles },
      }),
    }),
    getHandler: () => handler,
    getClass: () => WarehouseJobsController,
  } as any;
}

describe('WarehouseJobsController metadata', () => {
  it('registers route prefix warehouse-jobs', () => {
    const path = Reflect.getMetadata(PATH_METADATA, WarehouseJobsController);
    expect(path).toBe('warehouse-jobs');
  });

  it('uses AuthGuard, TenantGuard, RoleGuard, ModuleEntitlementGuard, DestructiveActionGuard', () => {
    expect(controllerSource).toMatch(
      /@UseGuards\(\s*AuthGuard,\s*TenantGuard,\s*RoleGuard,\s*ModuleEntitlementGuard,\s*DestructiveActionGuard\s*\)/,
    );
    expect(controllerSource).toContain('AuthGuard');
    expect(controllerSource).toContain('TenantGuard');
    expect(controllerSource).toContain('RoleGuard');
    expect(controllerSource).toContain('ModuleEntitlementGuard');
    expect(controllerSource).toContain('DestructiveActionGuard');
  });

  it('defaults class roles to tenant/warehouse admin and warehouse staff', () => {
    const classRoles = Reflect.getMetadata('roles', WarehouseJobsController);
    expect(classRoles).toEqual(READ_ROLES);
    for (const blocked of BLOCKED_ROLES) {
      expect(classRoles).not.toContain(blocked);
    }
  });

  describe.each([
    ['list', WarehouseJobsController.prototype.list],
    ['getById', WarehouseJobsController.prototype.getById],
    ['listLines', WarehouseJobsController.prototype.listLines],
    ['listUnits', WarehouseJobsController.prototype.listUnits],
    ['listDocuments', WarehouseJobsController.prototype.listDocuments],
    ['reportPreview', WarehouseJobsController.prototype.reportPreview],
  ])('read endpoint %s', (_name, handler) => {
    it('allows TENANT_ADMIN, WAREHOUSE_ADMIN, WAREHOUSE_STAFF', () => {
      expect(getEffectiveRoles(handler)).toEqual(READ_ROLES);
    });
  });

  describe.each([
    ['uploadDocument', WarehouseJobsController.prototype.uploadDocument],
    ['updateExecution', WarehouseJobsController.prototype.updateExecution],
    ['start', WarehouseJobsController.prototype.start],
    ['complete', WarehouseJobsController.prototype.complete],
  ])('floor endpoint %s', (_name, handler) => {
    it('allows TENANT_ADMIN, WAREHOUSE_ADMIN, WAREHOUSE_STAFF', () => {
      expect(getEffectiveRoles(handler)).toEqual(FLOOR_ROLES);
    });

    it('does not allow FINANCE_ADMIN or TRANSPORT_ADMIN', () => {
      expect(getEffectiveRoles(handler)).not.toContain(
        CanonicalTenantRole.FINANCE_ADMIN,
      );
      expect(getEffectiveRoles(handler)).not.toContain(
        CanonicalTenantRole.TRANSPORT_ADMIN,
      );
    });
  });

  describe.each([
    ['create', WarehouseJobsController.prototype.create],
    ['update', WarehouseJobsController.prototype.update],
    ['open', WarehouseJobsController.prototype.open],
    ['cancel', WarehouseJobsController.prototype.cancel],
    ['createLine', WarehouseJobsController.prototype.createLine],
    ['updateLine', WarehouseJobsController.prototype.updateLine],
    ['deleteLine', WarehouseJobsController.prototype.deleteLine],
    ['linkJobUnits', WarehouseJobsController.prototype.linkJobUnits],
    ['confirmJobUnits', WarehouseJobsController.prototype.confirmJobUnits],
    ['releaseJobUnits', WarehouseJobsController.prototype.releaseJobUnits],
    ['linkLineUnits', WarehouseJobsController.prototype.linkLineUnits],
    ['confirmLineUnits', WarehouseJobsController.prototype.confirmLineUnits],
    ['releaseLineUnits', WarehouseJobsController.prototype.releaseLineUnits],
    ['updateDocument', WarehouseJobsController.prototype.updateDocument],
    ['deleteDocument', WarehouseJobsController.prototype.deleteDocument],
    ['approveDocument', WarehouseJobsController.prototype.approveDocument],
    ['rejectDocument', WarehouseJobsController.prototype.rejectDocument],
  ])('mutating endpoint %s', (_name, handler) => {
    it('allows TENANT_ADMIN and WAREHOUSE_ADMIN only', () => {
      expect(getEffectiveRoles(handler)).toEqual(MUTATE_ROLES);
    });

    it('does not allow FINANCE_ADMIN, TRANSPORT_ADMIN, or WAREHOUSE_STAFF', () => {
      expect(getEffectiveRoles(handler)).not.toContain(
        CanonicalTenantRole.FINANCE_ADMIN,
      );
      expect(getEffectiveRoles(handler)).not.toContain(
        CanonicalTenantRole.TRANSPORT_ADMIN,
      );
      expect(getEffectiveRoles(handler)).not.toContain(
        CanonicalTenantRole.WAREHOUSE_STAFF,
      );
    });
  });

  it('does not import transport modules', () => {
    expect(controllerSource).not.toMatch(/from ['"].*\/transport\//);
    expect(controllerSource).not.toMatch(/from ['"]@\/transport\//);
  });
});

describe('RoleGuard + WarehouseJobsController', () => {
  const reflector = new Reflector();
  const guard = new RoleGuard(reflector);

  it('WAREHOUSE role exists in Role enum', () => {
    expect(Object.values(Role)).toContain(Role.WAREHOUSE);
  });

  describe('read routes', () => {
    const handler = WarehouseJobsController.prototype.list;

    it.each([
      CanonicalTenantRole.TENANT_ADMIN,
      CanonicalTenantRole.WAREHOUSE_ADMIN,
      CanonicalTenantRole.WAREHOUSE_STAFF,
      Role.WAREHOUSE,
    ])('allows %s', (role) => {
      expect(guard.canActivate(ctxForHandler(handler, role))).toBe(true);
    });

    it.each([
      CanonicalTenantRole.TRANSPORT_ADMIN,
      CanonicalTenantRole.FINANCE_ADMIN,
      Role.DRIVER,
      Role.CUSTOMER,
    ])('rejects %s', (role) => {
      expect(() => guard.canActivate(ctxForHandler(handler, role))).toThrow(
        /Required role/,
      );
    });
  });

  describe('mutating header route', () => {
    const handler = WarehouseJobsController.prototype.create;

    it.each([
      CanonicalTenantRole.TENANT_ADMIN,
      CanonicalTenantRole.WAREHOUSE_ADMIN,
    ])('allows %s', (role) => {
      expect(guard.canActivate(ctxForHandler(handler, role))).toBe(true);
    });

    it.each([
      CanonicalTenantRole.WAREHOUSE_STAFF,
      Role.WAREHOUSE,
      CanonicalTenantRole.FINANCE_ADMIN,
      CanonicalTenantRole.TRANSPORT_ADMIN,
      Role.DRIVER,
      Role.CUSTOMER,
    ])('rejects %s', (role) => {
      expect(() => guard.canActivate(ctxForHandler(handler, role))).toThrow(
        /Required role/,
      );
    });
  });

  describe('mutating line route', () => {
    const handler = WarehouseJobsController.prototype.createLine;

    it.each([
      CanonicalTenantRole.TENANT_ADMIN,
      CanonicalTenantRole.WAREHOUSE_ADMIN,
    ])('allows %s', (role) => {
      expect(guard.canActivate(ctxForHandler(handler, role))).toBe(true);
    });

    it('rejects FINANCE_ADMIN', () => {
      expect(() =>
        guard.canActivate(
          ctxForHandler(handler, CanonicalTenantRole.FINANCE_ADMIN),
        ),
      ).toThrow(/Required role/);
    });
  });

  describe('mutating unit route', () => {
    const handler = WarehouseJobsController.prototype.confirmJobUnits;

    it.each([
      CanonicalTenantRole.TENANT_ADMIN,
      CanonicalTenantRole.WAREHOUSE_ADMIN,
    ])('allows %s', (role) => {
      expect(guard.canActivate(ctxForHandler(handler, role))).toBe(true);
    });

    it.each([
      CanonicalTenantRole.FINANCE_ADMIN,
      Role.DRIVER,
      Role.CUSTOMER,
      Role.WAREHOUSE,
    ])('rejects %s', (role) => {
      expect(() => guard.canActivate(ctxForHandler(handler, role))).toThrow(
        /Required role/,
      );
    });
  });
});

describe('WarehouseJobsController delegation', () => {
  const tenantId = 'tenant-1';
  const jobId = 'job-1';
  const lineId = 'line-1';
  const actorUserId = 'user-ops';
  const req = {
    tenant: { tenantId, role: Role.TRANSPORT_STAFF },
    user: { userId: actorUserId },
  };

  function makeController() {
    const warehouseJobDocumentsService = {
      list: jest.fn().mockResolvedValue([]),
      upload: jest.fn().mockResolvedValue({ id: 'doc-1' }),
      updateMetadata: jest.fn().mockResolvedValue({ id: 'doc-1' }),
      delete: jest.fn().mockResolvedValue({ deleted: true }),
      approve: jest.fn().mockResolvedValue({ id: 'doc-1' }),
      reject: jest.fn().mockResolvedValue({ id: 'doc-1' }),
    };
    const warehouseJobReportPreviewService = {
      getReportPreview: jest.fn().mockResolvedValue({ job: { id: jobId } }),
    };
    const warehouseJobsService = {
      create: jest.fn().mockResolvedValue({ id: jobId }),
      list: jest.fn().mockResolvedValue({ data: [], meta: {} }),
      getById: jest.fn().mockResolvedValue({ id: jobId }),
      update: jest.fn().mockResolvedValue({ id: jobId }),
      updateExecution: jest.fn().mockResolvedValue({ id: jobId }),
      open: jest.fn().mockResolvedValue({ id: jobId }),
      start: jest.fn().mockResolvedValue({ id: jobId }),
      complete: jest.fn().mockResolvedValue({ id: jobId }),
      cancel: jest.fn().mockResolvedValue({ id: jobId }),
    };
    const warehouseJobLinesService = {
      list: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({ id: lineId }),
    };
    const warehouseJobUnitsService = {
      list: jest.fn().mockResolvedValue([]),
      linkToJob: jest.fn().mockResolvedValue({ linked: 1 }),
      linkToLine: jest.fn().mockResolvedValue({ linked: 1 }),
      confirmForJob: jest.fn().mockResolvedValue({ confirmed: 1 }),
      releaseForJob: jest.fn().mockResolvedValue({ released: 1 }),
    };

    const controller = new WarehouseJobsController(
      warehouseJobsService as any,
      warehouseJobLinesService as any,
      warehouseJobUnitsService as any,
      warehouseJobDocumentsService as any,
      warehouseJobReportPreviewService as any,
      { list: jest.fn(), create: jest.fn(), update: jest.fn(), delete: jest.fn() } as any,
    );

    return {
      controller,
      warehouseJobsService,
      warehouseJobLinesService,
      warehouseJobUnitsService,
      warehouseJobDocumentsService,
      warehouseJobReportPreviewService,
    };
  }

  it('delegates create to WarehouseJobsService.create', async () => {
    const { controller, warehouseJobsService } = makeController();
    const dto = { type: WarehouseJobType.RECEIVE };

    await controller.create(req, dto);

    expect(warehouseJobsService.create).toHaveBeenCalledWith(
      tenantId,
      dto,
      actorUserId,
    );
  });

  it('delegates list to WarehouseJobsService.list', async () => {
    const { controller, warehouseJobsService } = makeController();
    const query = { page: 1 };

    await controller.list(req, query as any);

    expect(warehouseJobsService.list).toHaveBeenCalledWith(
      tenantId,
      query,
      Role.WAREHOUSE,
      actorUserId,
    );
  });

  it('delegates lifecycle transitions to WarehouseJobsService facade methods', async () => {
    const { controller, warehouseJobsService } = makeController();

    await controller.open(req, jobId);
    await controller.start(req, jobId);
    await controller.complete(req, jobId);
    await controller.cancel(req, jobId, { reason: 'test' });

    expect(warehouseJobsService.open).toHaveBeenCalledWith(
      tenantId,
      jobId,
      actorUserId,
    );
    expect(warehouseJobsService.start).toHaveBeenCalledWith(
      tenantId,
      jobId,
      actorUserId,
      Role.WAREHOUSE,
    );
    expect(warehouseJobsService.complete).toHaveBeenCalledWith(
      tenantId,
      jobId,
      actorUserId,
      Role.WAREHOUSE,
    );
    expect(warehouseJobsService.cancel).toHaveBeenCalledWith(
      tenantId,
      jobId,
      actorUserId,
      'test',
    );
  });

  it('delegates createLine to WarehouseJobLinesService.create', async () => {
    const { controller, warehouseJobLinesService } = makeController();
    const dto = { requestedQty: 1 };

    await controller.createLine(req, jobId, dto);

    expect(warehouseJobLinesService.create).toHaveBeenCalledWith(
      tenantId,
      jobId,
      dto,
      actorUserId,
    );
  });

  it('delegates report preview to WarehouseJobReportPreviewService', async () => {
    const { controller, warehouseJobReportPreviewService } = makeController();

    await controller.reportPreview(req, jobId);

    expect(warehouseJobReportPreviewService.getReportPreview).toHaveBeenCalledWith(
      tenantId,
      { role: Role.WAREHOUSE, userId: actorUserId },
      jobId,
    );
  });

  it('delegates unit link/confirm/release to WarehouseJobUnitsService', async () => {
    const { controller, warehouseJobUnitsService } = makeController();
    const linkDto = { inventoryUnitIds: ['unit-1'] };
    const confirmDto = { inventoryUnitIds: ['unit-1'] };
    const releaseDto = { inventoryUnitIds: ['unit-1'] };

    await controller.linkJobUnits(req, jobId, linkDto);
    await controller.confirmJobUnits(req, jobId, confirmDto);
    await controller.releaseJobUnits(req, jobId, releaseDto);

    expect(warehouseJobUnitsService.linkToJob).toHaveBeenCalledWith(
      tenantId,
      jobId,
      linkDto,
      actorUserId,
    );
    expect(warehouseJobUnitsService.confirmForJob).toHaveBeenCalledWith(
      tenantId,
      jobId,
      confirmDto,
      actorUserId,
    );
    expect(warehouseJobUnitsService.releaseForJob).toHaveBeenCalledWith(
      tenantId,
      jobId,
      releaseDto,
      actorUserId,
    );
  });
});
