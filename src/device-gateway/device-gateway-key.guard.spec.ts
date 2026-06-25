import { ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { DeviceGatewayKeyGuard } from "./guards/device-gateway-key.guard";

describe("DeviceGatewayKeyGuard", () => {
  const guard = new DeviceGatewayKeyGuard();
  const originalKey = process.env.DEVICE_GATEWAY_KEY;

  afterEach(() => {
    if (originalKey === undefined) {
      delete process.env.DEVICE_GATEWAY_KEY;
    } else {
      process.env.DEVICE_GATEWAY_KEY = originalKey;
    }
  });

  function makeContext(headers: Record<string, string>): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ headers }),
      }),
    } as ExecutionContext;
  }

  it("allows request when x-device-gateway-key matches env", () => {
    process.env.DEVICE_GATEWAY_KEY = "secret-key";

    expect(
      guard.canActivate(
        makeContext({ "x-device-gateway-key": "secret-key" }),
      ),
    ).toBe(true);
  });

  it("rejects missing header with 401", () => {
    process.env.DEVICE_GATEWAY_KEY = "secret-key";

    expect(() => guard.canActivate(makeContext({}))).toThrow(
      UnauthorizedException,
    );
  });

  it("rejects invalid header with 401", () => {
    process.env.DEVICE_GATEWAY_KEY = "secret-key";

    expect(() =>
      guard.canActivate(makeContext({ "x-device-gateway-key": "wrong" })),
    ).toThrow(UnauthorizedException);
  });
});
