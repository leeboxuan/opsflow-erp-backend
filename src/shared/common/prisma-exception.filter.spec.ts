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

  it("maps P2002 username conflicts to 409 without leaking Prisma or email details", () => {
    const filter = new PrismaExceptionFilter();
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const host: any = {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
      }),
    };

    filter.catch(
      {
        code: "P2002",
        meta: { target: ["username"] },
        message: "Unique constraint failed on acme.ahmad@auth.opsflow.app",
      } as any,
      host,
    );

    expect(status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(json).toHaveBeenCalledWith({
      statusCode: HttpStatus.CONFLICT,
      message: "Username is already taken",
    });
    expect(JSON.stringify(json.mock.calls[0][0])).not.toContain(
      "auth.opsflow.app",
    );
  });

  it("maps functional username unique-index P2002 to the same 409", () => {
    const filter = new PrismaExceptionFilter();
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const host: any = {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
      }),
    };

    filter.catch(
      {
        code: "P2002",
        meta: { target: ["users_username_normalized_key"] },
        message: "Unique constraint failed",
      } as any,
      host,
    );

    expect(status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(json).toHaveBeenCalledWith({
      statusCode: HttpStatus.CONFLICT,
      message: "Username is already taken",
    });
  });

  it("does not treat generic unique failures as username taken", () => {
    const filter = new PrismaExceptionFilter();
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const host: any = {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
      }),
    };

    filter.catch(
      {
        code: "P2002",
        meta: { target: [] },
        message: "Unique constraint failed",
      } as any,
      host,
    );

    expect(json).toHaveBeenCalledWith({
      statusCode: HttpStatus.CONFLICT,
      message: "This record already exists",
    });
  });

  it("maps other P2002 conflicts to a generic 409", () => {
    const filter = new PrismaExceptionFilter();
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const host: any = {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
      }),
    };

    filter.catch(
      {
        code: "P2002",
        meta: { target: ["email"] },
        message: "Unique constraint failed on email",
      } as any,
      host,
    );

    expect(status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(json).toHaveBeenCalledWith({
      statusCode: HttpStatus.CONFLICT,
      message: "This record already exists",
    });
  });
});
