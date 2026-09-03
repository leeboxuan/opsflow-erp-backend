import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import { Role, TenantModule } from "@prisma/client";
import { AuthGuard } from "../../shared/auth/guards/auth.guard";
import { TenantGuard } from "../../shared/auth/guards/tenant.guard";
import { RoleGuard, Roles } from "../../shared/auth/guards/role.guard";
import {
  ModuleEntitlementGuard,
  RequiresTenantModule,
} from "../../shared/auth/guards/module-entitlement.guard";
import { AccessSurface } from "../../shared/auth/guards/access-surface.guard";
import {
  AddTripExpenseAttachmentDto,
  CreateTripExpenseDto,
  UpdateTripExpenseDto,
} from "../finance/dto/trip-expense.dto";
import {
  TripExpensesService,
  TRIP_EXPENSE_RECEIPT_MAX_BYTES,
} from "../finance/trip-expenses.service";

@ApiTags("driver-trip-expenses")
@Controller("drivers/jobs/:jobId/trips/:tripId/expenses")
@UseGuards(AuthGuard, TenantGuard, RoleGuard, ModuleEntitlementGuard)
@RequiresTenantModule(TenantModule.TRANSPORT)
@Roles(Role.DRIVER)
@AccessSurface("driver")
@ApiBearerAuth("JWT-auth")
export class DriverTripExpensesController {
  constructor(private readonly expenses: TripExpensesService) {}

  @Get()
  @ApiOperation({ summary: "List own expenses for an assigned trip" })
  list(
    @Req() req: any,
    @Param("jobId") jobId: string,
    @Param("tripId") tripId: string,
  ) {
    return this.expenses.listForDriverTrip(
      req.tenant.tenantId,
      jobId,
      tripId,
      req.user.userId,
    );
  }

  @Get(":expenseId")
  getOne(@Req() req: any, @Param("expenseId") expenseId: string) {
    return this.expenses.getForDriver(
      req.tenant.tenantId,
      expenseId,
      req.user.userId,
    );
  }

  @Post()
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        file: { type: "string", format: "binary" },
        category: { type: "string" },
        paymentMethod: { type: "string" },
        amountCents: { type: "integer" },
        currency: { type: "string" },
        transactionDate: { type: "string" },
        remarks: { type: "string" },
        operationKey: { type: "string" },
      },
      required: [
        "category",
        "paymentMethod",
        "amountCents",
        "transactionDate",
        "operationKey",
      ],
    },
  })
  @UseInterceptors(
    FileInterceptor("file", { limits: { fileSize: TRIP_EXPENSE_RECEIPT_MAX_BYTES } }),
  )
  create(
    @Req() _req: any,
    @Param("jobId") _jobId: string,
    @Param("tripId") _tripId: string,
    @Body() _dto: CreateTripExpenseDto,
    @UploadedFile() _file?: Express.Multer.File,
  ) {
    throw new ForbiddenException("Drivers cannot create trip expenses");
  }

  @Patch(":expenseId")
  update(
    @Req() _req: any,
    @Param("expenseId") _expenseId: string,
    @Body() _dto: UpdateTripExpenseDto,
  ) {
    throw new ForbiddenException("Drivers cannot update trip expenses");
  }

  @Post(":expenseId/attachments")
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      properties: {
        file: { type: "string", format: "binary" },
        operationKey: { type: "string" },
      },
      required: ["file", "operationKey"],
    },
  })
  @UseInterceptors(
    FileInterceptor("file", { limits: { fileSize: TRIP_EXPENSE_RECEIPT_MAX_BYTES } }),
  )
  addAttachment(
    @Req() _req: any,
    @Param("expenseId") _expenseId: string,
    @UploadedFile() _file: Express.Multer.File,
    @Body() _body: AddTripExpenseAttachmentDto,
  ) {
    throw new ForbiddenException("Drivers cannot add trip expense receipts");
  }

  @Get(":expenseId/attachments/:attachmentId/signed-url")
  signedUrl(
    @Req() req: any,
    @Param("expenseId") expenseId: string,
    @Param("attachmentId") attachmentId: string,
  ) {
    return this.expenses.getAttachmentSignedUrl(
      req.tenant.tenantId,
      expenseId,
      attachmentId,
      { driverUserId: req.user.userId },
    );
  }
}
