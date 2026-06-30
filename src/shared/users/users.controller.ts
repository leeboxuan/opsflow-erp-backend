import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Patch,
  Post,
  Request,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from "@nestjs/swagger";
import { FileInterceptor } from "@nestjs/platform-express";
import { AuthGuard } from "../../auth/guards/auth.guard";
import { TenantGuard } from "../../auth/guards/tenant.guard";
import {
  UpdateMyAvatarResponseDto,
  UpdateMyProfileDto,
  UserMeDto,
} from "./dto/users.dto";
import { UsersService } from "./users.service";

@ApiTags("users")
@Controller("users")
@UseGuards(AuthGuard, TenantGuard)
@ApiBearerAuth("JWT-auth")
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get("me")
  @ApiOperation({ summary: "Get current authenticated user profile" })
  async getMe(@Request() req: any): Promise<UserMeDto> {
    return this.usersService.getMyProfile(req.tenant.tenantId, req.user.userId);
  }

  @Patch("me")
  @ApiOperation({ summary: "Update current authenticated user profile" })
  async patchMe(
    @Request() req: any,
    @Body() dto: UpdateMyProfileDto,
  ): Promise<UserMeDto> {
    return this.usersService.updateMyProfile(
      req.tenant.tenantId,
      req.user.userId,
      req.tenant.role,
      dto,
    );
  }

  @Post("me/avatar")
  @ApiOperation({ summary: "Upload or replace current user avatar" })
  @ApiConsumes("multipart/form-data")
  @ApiBody({
    schema: {
      type: "object",
      required: ["file"],
      properties: {
        file: { type: "string", format: "binary" },
      },
    },
  })
  @UseInterceptors(FileInterceptor("file"))
  async uploadAvatar(
    @Request() req: any,
    @UploadedFile() file: Express.Multer.File,
  ): Promise<UpdateMyAvatarResponseDto> {
    if (!file) throw new BadRequestException("file is required");
    return this.usersService.uploadMyAvatar(
      req.tenant.tenantId,
      req.user.userId,
      file,
    );
  }

  @Delete("me/avatar")
  @ApiOperation({ summary: "Remove current user avatar" })
  async deleteAvatar(@Request() req: any): Promise<UserMeDto> {
    return this.usersService.deleteMyAvatar(req.tenant.tenantId, req.user.userId);
  }
}
