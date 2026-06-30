import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { SupabaseService } from "../../auth/supabase.service";
import { Role } from "@prisma/client";
import {
  UpdateMyAvatarResponseDto,
  UpdateMyProfileDto,
  UserMeDto,
} from "./dto/users.dto";
import { getUserAvatarSignedUrl } from "./user-avatar";

const USER_PROFILE_PICTURES_BUCKET = "user-profile-pictures";
const MAX_AVATAR_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_AVATAR_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly supabaseService: SupabaseService,
  ) {}

  private getAvatarExtFromMimeType(mimeType: string): string {
    const normalized = String(mimeType ?? "").toLowerCase();
    if (normalized === "image/jpeg") return "jpg";
    if (normalized === "image/png") return "png";
    if (normalized === "image/webp") return "webp";
    throw new BadRequestException(
      "Only image/jpeg, image/png, and image/webp are allowed",
    );
  }

  private mapStorageError(error: { message?: string } | null | undefined): never {
    const message = String(error?.message ?? "");
    if (
      message.toLowerCase().includes("bucket") &&
      message.toLowerCase().includes("not found")
    ) {
      throw new BadRequestException(
        "Storage bucket 'user-profile-pictures' does not exist. Create it in Supabase Storage.",
      );
    }
    throw new BadRequestException(`Storage operation failed: ${message || "unknown error"}`);
  }

  async getUserAvatarSignedUrl(
    avatarKey: string | null | undefined,
  ): Promise<string | null> {
    return getUserAvatarSignedUrl({
      supabaseService: this.supabaseService,
      avatarKey,
      onError: (error) => this.mapStorageError(error),
    });
  }

  private async loadTenantScopedUserOrThrow(tenantId: string, userId: string) {
    const user = await this.prisma.user.findFirst({
      where: {
        id: userId,
        memberships: {
          some: {
            tenantId,
          },
        },
      },
    });
    if (!user) throw new NotFoundException("User not found");
    return user;
  }

  async updateUserDisplayNameAndPropagate(params: {
    tenantId: string;
    userId: string;
    newName: string;
    actorUserId: string | null;
  }): Promise<any> {
    const normalizedName = String(params.newName ?? "").trim();
    if (!normalizedName) {
      throw new BadRequestException("displayName cannot be empty");
    }
    const updatedUser = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.update({
        where: { id: params.userId },
        data: {
          name: normalizedName,
          displayName: normalizedName,
        },
      });

      // Driver-centric display names
      await tx.drivers.updateMany({
        where: { tenantId: params.tenantId, userId: params.userId },
        data: { name: normalizedName, updatedAt: new Date() },
      });

      // Snapshot name propagation for uploaded/signed documents
      await tx.jobDocument.updateMany({
        where: { tenantId: params.tenantId, uploadedByUserId: params.userId },
        data: { uploadedByNameSnapshot: normalizedName },
      });
      await tx.tripDocument.updateMany({
        where: { tenantId: params.tenantId, uploadedByUserId: params.userId },
        data: { uploadedByNameSnapshot: normalizedName },
      });
      await tx.tripDocument.updateMany({
        where: { tenantId: params.tenantId, signedByUserId: params.userId },
        data: { signedByName: normalizedName },
      });

      return user;
    });

    const authUserId = String((updatedUser as any)?.authUserId ?? "").trim();
    if (authUserId) {
      try {
        const { error } = await this.supabaseService
          .getClient()
          .auth.admin.updateUserById(authUserId, {
          user_metadata: {
            name: normalizedName,
            displayName: normalizedName,
          },
        });
        if (error) {
          this.logger.warn("Failed to sync Supabase auth user metadata after profile update", {
            userId: params.userId,
            authUserId,
            error: error.message ?? "unknown error",
          } as any);
        }
      } catch (error) {
        this.logger.warn("Failed to sync Supabase auth user metadata after profile update", {
          userId: params.userId,
          authUserId,
          error: (error as Error)?.message ?? String(error),
        } as any);
      }
    }

    return updatedUser;
  }

  private async toMeDto(tenantId: string, user: any): Promise<UserMeDto> {
    const avatarUrl = await this.getUserAvatarSignedUrl(user.avatarKey);
    return {
      id: user.id,
      email: user.email,
      name: user.name ?? null,
      displayName: user.displayName ?? user.name ?? user.email,
      role: user.role,
      tenantId,
      avatarUrl,
      avatarKey: user.avatarKey ?? null,
      avatarUpdatedAt: user.avatarUpdatedAt ?? null,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }

  async getMyProfile(tenantId: string, userId: string): Promise<UserMeDto> {
    const user = await this.loadTenantScopedUserOrThrow(tenantId, userId);
    return this.toMeDto(tenantId, user);
  }

  async updateMyProfile(
    tenantId: string,
    userId: string,
    tenantRole: Role,
    dto: UpdateMyProfileDto,
  ): Promise<UserMeDto> {
    const currentUser = await this.loadTenantScopedUserOrThrow(tenantId, userId);
    const requestedName = dto.displayName ?? dto.name;
    const hasNameUpdate = requestedName !== undefined;
    if (tenantRole === Role.DRIVER && hasNameUpdate) {
      throw new BadRequestException("Drivers cannot update name or email from profile.");
    }
    let updated = currentUser;
    if (hasNameUpdate) {
      const newName = String(requestedName ?? "").trim();
      if (!newName) {
        throw new BadRequestException("displayName cannot be empty");
      }
      updated = await this.updateUserDisplayNameAndPropagate({
        tenantId,
        userId,
        newName,
        actorUserId: userId,
      });
    }
    return this.toMeDto(tenantId, updated);
  }

  async uploadMyAvatar(
    tenantId: string,
    userId: string,
    file: Express.Multer.File,
  ): Promise<UpdateMyAvatarResponseDto> {
    if (!file) throw new BadRequestException("file is required");
    if (!ALLOWED_AVATAR_MIME_TYPES.has(file.mimetype)) {
      throw new BadRequestException(
        "Only image/jpeg, image/png, and image/webp are allowed",
      );
    }
    if ((file.size ?? 0) > MAX_AVATAR_FILE_SIZE_BYTES) {
      throw new BadRequestException("Avatar file size must be <= 5MB");
    }

    const user = await this.loadTenantScopedUserOrThrow(tenantId, userId);
    const ext = this.getAvatarExtFromMimeType(file.mimetype);
    const nextKey = `${tenantId}/users/${userId}/avatar.${ext}`;
    const previousKey = String(user.avatarKey ?? "").trim() || null;

    const supabase = this.supabaseService.getClient();
    const { error: uploadError } = await supabase.storage
      .from(USER_PROFILE_PICTURES_BUCKET)
      .upload(nextKey, file.buffer, {
        contentType: file.mimetype,
        upsert: true,
      });
    if (uploadError) this.mapStorageError(uploadError);

    if (previousKey && previousKey !== nextKey) {
      await supabase.storage.from(USER_PROFILE_PICTURES_BUCKET).remove([previousKey]);
    }

    const updatedAt = new Date();
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        avatarKey: nextKey,
        avatarUrl: null,
        avatarUpdatedAt: updatedAt,
      },
    });
    return {
      avatarKey: nextKey,
      avatarUrl: await this.getUserAvatarSignedUrl(nextKey),
      avatarUpdatedAt: updatedAt,
    };
  }

  async deleteMyAvatar(tenantId: string, userId: string): Promise<UserMeDto> {
    const user = await this.loadTenantScopedUserOrThrow(tenantId, userId);
    const avatarKey = String(user.avatarKey ?? "").trim();
    if (avatarKey) {
      await this.supabaseService
        .getClient()
        .storage.from(USER_PROFILE_PICTURES_BUCKET)
        .remove([avatarKey]);
    }
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        avatarKey: null,
        avatarUrl: null,
        avatarUpdatedAt: null,
      },
    });
    return this.toMeDto(tenantId, updated);
  }
}
