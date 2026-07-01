import { Role, WarehouseJobType } from '@prisma/client';
import { PATH_METADATA } from '@nestjs/common/constants';
import { Reflector } from '@nestjs/core';
import { readFileSync } from 'fs';
import { join } from 'path';
import { RoleGuard } from '../../shared/auth/guards/role.guard';
import { WarehouseJobsController } from './warehouse-jobs.controller';

const controllerPath = join(__dirname, 'warehouse-jobs.controller.ts');
const controllerSource = readFileSync(controllerPath, 'utf8');

const READ_ROLES = [Role.ADMIN, Role.OPS, Role.FINANCE, Role.WAREHOUSE];
const MUTATE_ROLES = [Role.ADMIN, Role.OPS];
const FLOOR_ROLES = [Role.ADMIN, Role.OPS, Role.WAREHOUSE];
const BLOCKED_ROLES = [Role.DRIVER, Role.CUSTOMER];

function getEffectiveRoles(
  handler: (...args: unknown[]) => unknown,
): Role[] {
  const reflector = new Reflector();
  return (
    reflector.getAllAndOverride<Role[]>('roles', [
      handler,
      WarehouseJobsController,
    ]) ?? []
  );
}

function ctxForHandler(
  handler: (...args: unknown[]) => unknown,
  role: Role,
) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ tenant: { tenantId: 'tenant-1', role } }),
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

  it('uses AuthGuard, TenantGuard, and RoleGuard at class level', () => {
    expect(controllerSource).toMatch(
      /@UseGuards\(AuthGuard, TenantGuard, RoleGuard\)/,
    );
    expect(controllerSource).toContain('AuthGuard');
    expect(controllerSource).toContain('TenantGuard');
    expect(controllerSource).toContain('RoleGuard');
  });

  it('defaults class roles to ADMIN, OPS, FINANCE, WAREHOUSE (excludes DRIVER and CUSTOMER)', () => {
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
  ])('read endpoint %s', (_name, handler) => {
    it('allows ADMIN, OPS, FINANCE, WAREHOUSE', () => {
      expect(getEffectiveRoles(handler)).toEqual(READ_ROLES);
    });
  });

  describe.each([
    ['uploadDocument', WarehouseJobsController.prototype.uploadDocument],
    ['updateExecution', WarehouseJobsController.prototype.updateExecution],
    ['start', WarehouseJobsController.prototype.start],
    ['complete', WarehouseJobsController.prototype.complete],
  ])('floor endpoint %s', (_name, handler) => {
    it('allows ADMIN, OPS, WAREHOUSE', () => {
      expect(getEffectiveRoles(handler)).toEqual(FLOOR_ROLES);
    });

    it('does not allow FINANCE', () => {
      expect(getEffectiveRoles(handler)).not.toContain(Role.FINANCE);
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
    it('allows ADMIN and OPS only', () => {
      expect(getEffectiveRoles(handler)).toEqual(MUTATE_ROLES);
    });

    it('does not allow FINANCE', () => {
      expect(getEffectiveRoles(handler)).not.toContain(Role.FINANCE);
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

    it.each([Role.ADMIN, Role.OPS, Role.FINANCE, Role.WAREHOUSE])(
      'allows %s',
      (role) => {
        expect(guard.canActivate(ctxForHandler(handler, role))).toBe(true);
      },
    );

    it.each(BLOCKED_ROLES)('rejects %s', (role) => {
      expect(() => guard.canActivate(ctxForHandler(handler, role))).toThrow(
        /Required role/,
      );
    });
  });

  describe('mutating header route', () => {
    const handler = WarehouseJobsController.prototype.create;

    it.each(MUTATE_ROLES)('allows %s', (role) => {
      expect(guard.canActivate(ctxForHandler(handler, role))).toBe(true);
    });

    it.each([Role.FINANCE, ...BLOCKED_ROLES])('rejects %s', (role) => {
      expect(() => guard.canActivate(ctxForHandler(handler, role))).toThrow(
        /Required role/,
      );
    });
  });

  describe('mutating line route', () => {
    const handler = WarehouseJobsController.prototype.createLine;

    it.each(MUTATE_ROLES)('allows %s', (role) => {
      expect(guard.canActivate(ctxForHandler(handler, role))).toBe(true);
    });

    it('rejects FINANCE', () => {
      expect(() =>
        guard.canActivate(ctxForHandler(handler, Role.FINANCE)),
      ).toThrow(/Required role/);
    });
  });

  describe('mutating unit route', () => {
    const handler = WarehouseJobsController.prototype.confirmJobUnits;

    it.each(MUTATE_ROLES)('allows %s', (role) => {
      expect(guard.canActivate(ctxForHandler(handler, role))).toBe(true);
    });

    it.each([Role.FINANCE, Role.DRIVER, Role.CUSTOMER])('rejects %s', (role) => {
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
    tenant: { tenantId, role: Role.OPS },
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
    );

    return {
      controller,
      warehouseJobsService,
      warehouseJobLinesService,
      warehouseJobUnitsService,
      warehouseJobDocumentsService,
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
      Role.OPS,
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
      Role.OPS,
    );
    expect(warehouseJobsService.complete).toHaveBeenCalledWith(
      tenantId,
      jobId,
      actorUserId,
      Role.OPS,
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
