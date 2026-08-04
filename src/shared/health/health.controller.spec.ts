import { INestApplication } from "@nestjs/common";
import { PATH_METADATA, METHOD_METADATA } from "@nestjs/common/constants";
import { RequestMethod } from "@nestjs/common/enums/request-method.enum";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";
import { AuthService } from "../auth/auth.service";
import { AuthGuard } from "../auth/guards/auth.guard";
import { TenantGuard } from "../auth/guards/tenant.guard";
import { PrismaService } from "../prisma/prisma.service";
import { HealthController } from "./health.controller";

describe("HealthController", () => {
  const controller = new HealthController();

  it("registers GET health (global prefix api → /api/health)", () => {
    const path = Reflect.getMetadata(PATH_METADATA, HealthController);
    expect(path).toBe("health");

    const methodPath = Reflect.getMetadata(
      PATH_METADATA,
      HealthController.prototype.health,
    );
    expect(methodPath).toBe("/");

    const method = Reflect.getMetadata(
      METHOD_METADATA,
      HealthController.prototype.health,
    );
    expect(method).toBe(RequestMethod.GET);
  });

  it("returns { status: 'ok' } without auth or DB", () => {
    expect(controller.health()).toEqual({ status: "ok" });
  });

  it("does not apply guards on the public health endpoint", () => {
    const classGuards = Reflect.getMetadata("__guards__", HealthController);
    const handlerGuards = Reflect.getMetadata(
      "__guards__",
      HealthController.prototype.health,
    );
    expect(classGuards).toBeUndefined();
    expect(handlerGuards).toBeUndefined();
  });
});

describe("HealthController HTTP /api/health", () => {
  let app: INestApplication;

  beforeAll(async () => {
    // AuthGuard/TenantGuard are only used by GET /health/tenant; stubs keep DI happy.
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        AuthGuard,
        TenantGuard,
        { provide: AuthService, useValue: { verifyToken: jest.fn() } },
        { provide: PrismaService, useValue: {} },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix("api");
    await app.init();
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it("GET /api/health returns 200 { status: 'ok' }", async () => {
    const res = await request(app.getHttpServer()).get("/api/health");
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("HEAD /api/health returns 200 with no body", async () => {
    const res = await request(app.getHttpServer()).head("/api/health");
    expect(res.status).toBe(200);
    expect(res.text ?? "").toBe("");
  });
});
