import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import {
  USERNAME_TAKEN_MESSAGE,
  isPrismaUsernameUniqueConflict,
} from "../auth/username-uniqueness";

@Catch(Prisma.PrismaClientKnownRequestError)
export class PrismaExceptionFilter implements ExceptionFilter {
  catch(exception: Prisma.PrismaClientKnownRequestError, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse();

    if (exception.code === "P2024") {
      console.error("[PrismaExceptionFilter] Pool timeout", {
        code: exception.code,
      });
      return res.status(HttpStatus.SERVICE_UNAVAILABLE).json({
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        message: "Database is busy. Please try again.",
      });
    }

    if (exception.code === "P2002") {
      const message = isPrismaUsernameUniqueConflict(exception)
        ? USERNAME_TAKEN_MESSAGE
        : "This record already exists";
      return res.status(HttpStatus.CONFLICT).json({
        statusCode: HttpStatus.CONFLICT,
        message,
      });
    }

    return res.status(HttpStatus.BAD_REQUEST).json({
      statusCode: HttpStatus.BAD_REQUEST,
      message: "Request could not be completed",
    });
  }
}
