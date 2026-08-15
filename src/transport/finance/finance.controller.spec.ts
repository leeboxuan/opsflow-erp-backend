import { GoneException } from "@nestjs/common";
import { FinanceController } from "./finance.controller";

describe("FinanceController retired wallets", () => {
  const controller = new FinanceController();

  it("GET /finance/wallets returns 410 Gone", async () => {
    await expect(controller.getWalletSummaries()).rejects.toBeInstanceOf(
      GoneException,
    );
  });

  it("GET /finance/wallets/:driverId returns 410 Gone", async () => {
    await expect(controller.getWalletTransactions()).rejects.toBeInstanceOf(
      GoneException,
    );
  });
});
