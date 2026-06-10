import { HttpStatus } from "@nestjs/common";
import { AllExceptionsFilter } from "./all-exceptions.filter";

describe("AllExceptionsFilter", () => {
  function runFilter(exception: unknown) {
    const filter = new AllExceptionsFilter();
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const host: any = {
      switchToHttp: () => ({
        getRequest: () => ({ method: "POST", url: "/api/test" }),
        getResponse: () => ({ status }),
      }),
    };
    filter.catch(exception, host);
    return { status, json };
  }

  it("returns 413 for PayloadTooLargeError", () => {
    const { status, json } = runFilter({
      name: "PayloadTooLargeError",
      type: "entity.too.large",
      status: 413,
      message: "request entity too large",
    });

    expect(status).toHaveBeenCalledWith(HttpStatus.PAYLOAD_TOO_LARGE);
    expect(json).toHaveBeenCalledWith({
      statusCode: HttpStatus.PAYLOAD_TOO_LARGE,
      message: "Request payload is too large.",
      error: "Payload Too Large",
    });
  });

  it("returns 500 for unknown errors", () => {
    const { status, json } = runFilter(new Error("boom"));

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(json).toHaveBeenCalledWith({
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      message: "Internal server error",
    });
  });
});
