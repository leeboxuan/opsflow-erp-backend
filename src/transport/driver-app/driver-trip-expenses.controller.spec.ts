import { ForbiddenException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import {
  Role,
  TripExpenseCategory,
  TripExpensePaymentMethod,
} from "@prisma/client";
import { DriverTripExpensesController } from "./driver-trip-expenses.controller";
import { TripExpensesController } from "../finance/trip-expenses.controller";
import { TransportJobsController } from "../jobs/transport-jobs.controller";
import type { TripExpensesService } from "../finance/trip-expenses.service";

describe("Driver expense mutation boundaries", () => {
  const expenses: Pick<
    TripExpensesService,
    | "listForDriverTrip"
    | "getForDriver"
    | "getAttachmentSignedUrl"
    | "createForDriver"
    | "updateForDriver"
  > = {
    listForDriverTrip: jest.fn().mockResolvedValue([]),
    getForDriver: jest.fn(),
    getAttachmentSignedUrl: jest.fn(),
    createForDriver: jest.fn(),
    updateForDriver: jest.fn(),
  };
  const controller = new DriverTripExpensesController(
    expenses as TripExpensesService,
  );

  it("rejects create at the driver expenses controller", () => {
    expect(() =>
      controller.create(
        { tenant: { tenantId: "t1" }, user: { userId: "d1" } },
        "job1",
        "trip1",
        {
          category: TripExpenseCategory.TOLL,
          paymentMethod: TripExpensePaymentMethod.DRIVER_PAID,
          amountCents: 100,
          transactionDate: "2026-09-01",
          operationKey: "op-key-1234567890",
        },
        undefined,
      ),
    ).toThrow(ForbiddenException);
    expect(expenses.createForDriver).not.toHaveBeenCalled();
  });

  it("rejects update and receipt upload", () => {
    expect(() =>
      controller.update(
        { tenant: { tenantId: "t1" }, user: { userId: "d1" } },
        "exp1",
        { remarks: "x", operationKey: "op-key-1234567890" },
      ),
    ).toThrow(ForbiddenException);
    expect(() =>
      controller.addAttachment(
        { tenant: { tenantId: "t1" }, user: { userId: "d1" } },
        "exp1",
        {
          buffer: Buffer.from("x"),
          originalname: "r.jpg",
          mimetype: "image/jpeg",
          size: 1,
        } as Express.Multer.File,
        { operationKey: "op-key-1234567890" },
      ),
    ).toThrow(ForbiddenException);
  });

  it("still allows assigned-driver list reads", async () => {
    await controller.list(
      { tenant: { tenantId: "t1" }, user: { userId: "d1" } },
      "job1",
      "trip1",
    );
    expect(expenses.listForDriverTrip).toHaveBeenCalledWith(
      "t1",
      "job1",
      "trip1",
      "d1",
    );
  });

  it("Finance review controller does not expose create", () => {
    const names = Object.getOwnPropertyNames(TripExpensesController.prototype);
    expect(names).not.toContain("create");
    expect(names).toEqual(
      expect.arrayContaining(["list", "approve", "reject", "requestClarification"]),
    );
  });

  it("workspace createTripExpenseForWorkspace roles exclude DRIVER", () => {
    const reflector = new Reflector();
    const roles =
      reflector.getAllAndOverride<Array<string>>("roles", [
        TransportJobsController.prototype.createTripExpenseForWorkspace,
        TransportJobsController,
      ]) ?? [];
    expect(roles.map(String)).not.toContain(String(Role.DRIVER));
    expect(roles.map(String)).toEqual(
      expect.arrayContaining([String(Role.TRANSPORT_STAFF), String(Role.ADMIN)]),
    );
  });
});
