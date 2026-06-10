import { HttpStatus } from "@nestjs/common";

export const PAYLOAD_TOO_LARGE_MESSAGE = "Request payload is too large.";

export function isPayloadTooLargeError(exception: unknown): boolean {
  if (!exception || typeof exception !== "object") return false;
  const err = exception as {
    type?: string;
    status?: number;
    statusCode?: number;
    name?: string;
  };
  return (
    err.type === "entity.too.large"
    || err.name === "PayloadTooLargeError"
    || err.status === HttpStatus.PAYLOAD_TOO_LARGE
    || err.statusCode === HttpStatus.PAYLOAD_TOO_LARGE
  );
}

export function payloadTooLargeResponseBody() {
  return {
    statusCode: HttpStatus.PAYLOAD_TOO_LARGE,
    message: PAYLOAD_TOO_LARGE_MESSAGE,
    error: "Payload Too Large",
  };
}
