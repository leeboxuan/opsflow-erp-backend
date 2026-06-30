import { HttpStatus } from "@nestjs/common";
import { PrismaExceptionFilter } from "./prisma-exception.filter";

describe("PrismaExceptionFilter", () => {
  it("maps P2024 to 503 with safe message", () => {
    const filter = new PrismaExceptionFilter();
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const host: any = {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
      }),
    };

    filter.catch(
      { code: "P2024", meta: { timeout: 10 }, message: "pool timeout" } as any,
      host,
    );

    expect(status).toHaveBeenCalledWith(HttpStatus.SERVICE_UNAVAILABLE);
    expect(json).toHaveBeenCalledWith({
      statusCode: HttpStatus.SERVICE_UNAVAILABLE,
      message: "Database is busy. Please try again.",
    });
  });
});
