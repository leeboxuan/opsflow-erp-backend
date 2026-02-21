import { Injectable, NotFoundException, BadRequestException } from "@nestjs/common";
import { PrismaService } from "../prisma/prisma.service";
import { CreatePodDto } from "./dto/create-pod.dto";
import { PodDto } from "./dto/trip.dto";
import { EventLogService } from "./event-log.service";
import { SupabaseService } from "../auth/supabase.service";
import { randomUUID } from "crypto";

const POD_BUCKET = "pods-photos";

// Signed URLs are for viewing (download) only
const SIGNED_VIEW_URL_TTL_SECONDS = 60 * 10; // 10 minutes

// Signed upload URL TTL is managed by Supabase; we return this for UI hints
const SIGNED_UPLOAD_URL_TTL_SECONDS = 60 * 10; // 10 minutes

type Kind = "pod" | "signature" | "damage" | "do_signature";

function safeKind(kind?: string): Kind {
  const k = String(kind ?? "pod").toLowerCase().trim();
  if (k === "pod" || k === "signature" || k === "damage" || k === "do_signature") return k as Kind;
  return "pod";
}

function kindFolder(kind: Kind): string {
  if (kind === "do_signature") return "do-signatures";
  // keep POD-related uploads separated
  return "pod-photos";
}

function guessExt(mime: string, originalName: string): string {
  const lower = (originalName ?? "").toLowerCase();
  if (lower.endsWith(".png")) return "png";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "jpg";
  if (mime === "image/png") return "png";
  if (mime === "image/jpeg") return "jpg";
  return "jpg";
}

@Injectable()
export class PodService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly eventLogService: EventLogService,
    private readonly supabaseService: SupabaseService,
  ) {}

  async createOrUpdatePod(
    tenantId: string,
    stopId: string,
    dto: CreatePodDto,
  ): Promise<PodDto> {
    const stop = await this.prisma.stop.findFirst({
      where: { id: stopId, tenantId },
    });
    if (!stop) throw new NotFoundException("Stop not found");

    const existingPod = await this.prisma.pod.findFirst({
      where: { stopId, tenantId },
    });

    let podStatus = dto.status as any;
    if (!podStatus) {
      if (dto.signatureUrl || dto.signedBy) podStatus = "Completed" as any;
      else podStatus = "Pending" as any;
    }

    const photoUrlValue = dto.photoUrl || dto.signatureUrl || null;

    const pod = existingPod
      ? await this.prisma.pod.update({
          where: { id: existingPod.id },
          data: {
            status: podStatus,
            signedBy: dto.signedBy || null,
            signedAt: dto.signedAt ? new Date(dto.signedAt) : new Date(),
            photoUrl: photoUrlValue,
          },
        })
      : await this.prisma.pod.create({
          data: {
            tenantId,
            stopId,
            status: podStatus,
            signedBy: dto.signedBy || null,
            signedAt: dto.signedAt ? new Date(dto.signedAt) : new Date(),
            photoUrl: photoUrlValue,
            photoKeys: [],
          },
        });

    await this.eventLogService.logEvent(tenantId, "Stop", stopId, "POD_UPDATED", {
      podId: pod.id,
      status: pod.status,
      signedBy: pod.signedBy,
      signatureUrl: dto.signatureUrl,
      note: (dto as any).note,
    });

    return this.toDto(pod);
  }

  /**
   * Multipart upload (server uploads to Storage).
   * - kind=pod|signature|damage => append key to pod.photoKeys
   * - kind=do_signature => DO signature upload ONLY (DO NOT append to pod.photoKeys)
   */
  async uploadPodPhoto(
    tenantId: string,
    stopId: string,
    file: Express.Multer.File,
    kind?: string,
  ): Promise<{ key: string; signedUrl: string; expiresInSeconds: number }> {
    const stop = await this.prisma.stop.findFirst({ where: { id: stopId, tenantId } });
    if (!stop) throw new NotFoundException("Stop not found");

    const mime = String(file.mimetype ?? "");
    if (!mime.startsWith("image/")) {
      throw new BadRequestException(`Only image uploads supported. Got: ${mime}`);
    }

    const k = safeKind(kind);
    const ext = guessExt(mime, file.originalname ?? "upload.jpg");
    const folder = kindFolder(k);

    const filename = `${k}_${Date.now()}.${ext}`;
    const key = `${tenantId}/${folder}/${stopId}/${filename}`;

    const supabase = this.supabaseService.getClient();

    const { error: uploadErr } = await supabase.storage
      .from(POD_BUCKET)
      .upload(key, file.buffer, { contentType: mime, upsert: true });

    if (uploadErr) {
      throw new BadRequestException(`Storage upload failed: ${uploadErr.message}`);
    }

    // Only append to pod.photoKeys for POD-related photos
    if (k !== "do_signature") {
      const existing = await this.prisma.pod.findFirst({ where: { tenantId, stopId } });
      if (existing) {
        const current: string[] = Array.isArray(existing.photoKeys as any) ? (existing.photoKeys as any) : [];
        if (!current.includes(key)) {
          await this.prisma.pod.update({
            where: { id: existing.id },
            data: { photoKeys: [...current, key] as any },
          });
        }
      } else {
        await this.prisma.pod.create({
          data: {
            tenantId,
            stopId,
            status: "Pending" as any,
            photoKeys: [key],
          },
        });
      }
    }

    const { data, error: signErr } = await supabase.storage
      .from(POD_BUCKET)
      .createSignedUrl(key, SIGNED_VIEW_URL_TTL_SECONDS);

    if (signErr || !data?.signedUrl) {
      throw new BadRequestException(`Signed URL failed: ${signErr?.message ?? "unknown error"}`);
    }

    await this.eventLogService.logEvent(tenantId, "Stop", stopId, "PHOTO_UPLOADED", {
      key,
      kind: k,
      mime,
    });

    return { key, signedUrl: data.signedUrl, expiresInSeconds: SIGNED_VIEW_URL_TTL_SECONDS };
  }

  /**
   * Convert stored pod.photoKeys into signed view URLs
   * (DO signatures are not stored in pod.photoKeys)
   */
  async getPodPhotoSignedUrls(
    tenantId: string,
    stopId: string,
  ): Promise<{ items: { key: string; signedUrl: string }[]; expiresInSeconds: number }> {
    const stop = await this.prisma.stop.findFirst({ where: { id: stopId, tenantId } });
    if (!stop) throw new NotFoundException("Stop not found");

    const pod = await this.prisma.pod.findFirst({ where: { tenantId, stopId } });
    if (!pod) return { items: [], expiresInSeconds: SIGNED_VIEW_URL_TTL_SECONDS };

    const raw = (pod.photoKeys as any) ?? [];
    const keys: string[] = Array.isArray(raw) ? raw.filter(Boolean) : [];

    const supabase = this.supabaseService.getClient();

    const items: { key: string; signedUrl: string }[] = [];
    for (const key of keys) {
      const { data, error } = await supabase.storage
        .from(POD_BUCKET)
        .createSignedUrl(key, SIGNED_VIEW_URL_TTL_SECONDS);

      if (!error && data?.signedUrl) items.push({ key, signedUrl: data.signedUrl });
    }

    return { items, expiresInSeconds: SIGNED_VIEW_URL_TTL_SECONDS };
  }

  /**
   * Signed upload URL (Expo-friendly):
   * client does PUT uploadUrl with raw bytes
   * returns photoKey to store on stop/order.
   */
  async createSignedPhotoUpload(
    tenantId: string,
    stopId: string,
    kind?: string,
  ): Promise<{ uploadUrl: string; photoKey: string; expiresInSeconds: number }> {
    const stop = await this.prisma.stop.findFirst({
      where: { id: stopId, tenantId },
      select: { id: true },
    });
    if (!stop) throw new NotFoundException("Stop not found");

    const k = safeKind(kind);
    const folder = kindFolder(k);

    const filename = `${k}_${randomUUID()}.png`;
    const photoKey = `${tenantId}/${folder}/${stopId}/${filename}`;

    const supabase = this.supabaseService.getClient();

    // supabase-js v2 returns { data: { signedUrl, path, token }, error }
    const { data, error } = await (supabase.storage as any)
      .from(POD_BUCKET)
      .createSignedUploadUrl(photoKey);

    const uploadUrl = data?.signedUrl;
    if (error || !uploadUrl) {
      throw new BadRequestException(error?.message ?? "Failed to create signed upload URL");
    }

    return { uploadUrl, photoKey, expiresInSeconds: SIGNED_UPLOAD_URL_TTL_SECONDS };
  }

  private toDto(pod: any): PodDto {
    return {
      id: pod.id,
      status: pod.status,
      signedBy: pod.signedBy,
      signedAt: pod.signedAt,
      photoUrl: pod.photoUrl,
      createdAt: pod.createdAt,
      updatedAt: pod.updatedAt,
    };
  }
}