import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from "@nestjs/common";
import { Prisma } from "@prisma/client";

@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  catch(exception: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse();

    if (exception.code === "P2024") {
      console.error("[PrismaExceptionFilter] Pool timeout", {
        code: exception.code,
        meta: exception.meta,
      });
      return res.status(HttpStatus.SERVICE_UNAVAILABLE).json({
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        message: "Database is busy. Please try again.",
      });
    }

    const status =
      exception.code === "P2002" ? HttpStatus.CONFLICT : HttpStatus.BAD_REQUEST;

    res.status(status).json({
      statusCode: status,
      message: exception.message,
      prismaCode: exception.code,
    });
  }
}