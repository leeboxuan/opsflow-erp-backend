import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";

@Injectable()
export class DeviceGatewayKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const providedKey = String(request.headers["x-device-gateway-key"] ?? "").trim();
    const expectedKey = String(process.env.DEVICE_GATEWAY_KEY ?? "").trim();

    if (!expectedKey || !providedKey || providedKey !== expectedKey) {
      throw new UnauthorizedException();
    }

    return true;
  }
}
