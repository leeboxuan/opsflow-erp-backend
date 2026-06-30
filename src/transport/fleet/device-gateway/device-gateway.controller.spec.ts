import { INestApplication, ValidationPipe } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";
import { PrismaService } from "../../../prisma/prisma.service";
import { DeviceGatewayModule } from "./device-gateway.module";

describe("DeviceGatewayController registration", () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.DEVICE_GATEWAY_KEY = "test-device-gateway-key";

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [DeviceGatewayModule],
    })
      .overrideProvider(PrismaService)
      .useValue({
        gpsDevice: { findFirst: jest.fn(), update: jest.fn() },
        gpsPosition: { create: jest.fn() },
        $transaction: jest.fn(async (ops: unknown[]) => {
          for (const op of ops) {
            await op;
          }
        }),
      })
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix("api");
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("registers POST /api/internal/device-gateway/events", async () => {
    const missingKey = await request(app.getHttpServer())
      .post("/api/internal/device-gateway/events")
      .send({});

    expect(missingKey.status).toBe(401);

    const wrongPath = await request(app.getHttpServer())
      .post("/api/internal/device-gateway/missing")
      .send({});

    expect(wrongPath.status).toBe(404);
  });
});
