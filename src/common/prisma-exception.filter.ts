import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from "@nestjs/common";
import { Prisma } from "@prisma/client";

@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  catch(exception: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse();

    // Prisma known errors -> 400 (or tweak to 409 for unique constraint)
    const status =
      exception.code === "P2002" ? HttpStatus.CONFLICT : HttpStatus.BAD_REQUEST;

    res.status(status).json({
      statusCode: status,
      message: exception.message,
      prismaCode: exception.code,
      meta: exception.meta,
    });
  }
}