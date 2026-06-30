import {
    ArgumentsHost,
    Catch,
    ExceptionFilter,
    HttpException,
    HttpStatus,
  } from "@nestjs/common";
import {
  isPayloadTooLargeError,
  payloadTooLargeResponseBody,
} from "./payload-too-large";
  
  @Catch()
  export class AllExceptionsFilter implements ExceptionFilter {
    catch(exception: unknown, host: ArgumentsHost) {
      const ctx = host.switchToHttp();
      const req = ctx.getRequest();
      const res = ctx.getResponse();

      if (isPayloadTooLargeError(exception)) {
        return res
          .status(HttpStatus.PAYLOAD_TOO_LARGE)
          .json(payloadTooLargeResponseBody());
      }
  
      const isHttp = exception instanceof HttpException;
      const status = isHttp ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
  
      // Log full error server-side (Render logs will show this)
      console.error("[ERROR]", {
        method: req?.method,
        url: req?.url,
        status,
        exception,
      });
  
      // If it's an HttpException, keep Nest’s message payload
      if (isHttp) {
        const response = exception.getResponse();
        return res.status(status).json(
          typeof response === "string"
            ? { statusCode: status, message: response }
            : response,
        );
      }
  
      // Otherwise, return a clean 500
      return res.status(status).json({
        statusCode: status,
        message: "Internal server error",
      });
    }
  }