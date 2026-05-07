import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { SupabaseService } from "../auth/supabase.service";
import {
  UpdateMyAvatarResponseDto,
  UpdateMyProfileDto,
  UserMeDto,
} from "./dto/users.dto";

const USER_PROFILE_PICTURES_BUCKET = "user-profile-pictures";
const USER_AVATAR_SIGNED_URL_TTL_SECONDS = 60 * 60;
const MAX_AVATAR_FILE_SIZE_BYTES = 5 * 1024 * 1024;
const ALLOWED_AVATAR_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

@Injectable()
export class UsersService {
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

  private async createAvatarSignedUrl(
    avatarKey: string | null | undefined,
  ): Promise<string | null> {
    const key = String(avatarKey ?? "").trim();
    if (!key) return null;
    const { data, error } = await this.supabaseService
      .getClient()
      .storage.from(USER_PROFILE_PICTURES_BUCKET)
      .createSignedUrl(key, USER_AVATAR_SIGNED_URL_TTL_SECONDS);
    if (error || !data?.signedUrl) {
      if (error) this.mapStorageError(error);
      return null;
    }
    return data.signedUrl;
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

  private async toMeDto(tenantId: string, user: any): Promise<UserMeDto> {
    const avatarUrl = await this.createAvatarSignedUrl(user.avatarKey);
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
    dto: UpdateMyProfileDto,
  ): Promise<UserMeDto> {
    await this.loadTenantScopedUserOrThrow(tenantId, userId);
    const updated = await this.prisma.user.update({
      where: { id: userId },
      data: {
        ...(dto.name !== undefined ? { name: String(dto.name ?? "").trim() || null } : {}),
        ...(dto.displayName !== undefined
          ? { displayName: String(dto.displayName ?? "").trim() || null }
          : {}),
      },
    });
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
      avatarUrl: await this.createAvatarSignedUrl(nextKey),
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
