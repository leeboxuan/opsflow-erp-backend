import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreatePodDto } from './dto/create-pod.dto';
import { PodDto } from './dto/trip.dto';
import { EventLogService } from './event-log.service';
import { SupabaseService } from '../auth/supabase.service';

const POD_BUCKET = 'pods-photos';
const SIGNED_URL_TTL_SECONDS = 60 * 5; // 5 minutes

function safeKind(kind?: string): string {
  const k = String(kind ?? 'pod').toLowerCase().trim();
  if (k === 'pod' || k === 'signature' || k === 'damage') return k;
  return 'pod';
}

function guessExt(mime: string, originalName: string): string {
  const lower = originalName.toLowerCase();
  if (lower.endsWith('.png')) return 'png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'jpg';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/jpeg') return 'jpg';
  return 'jpg';
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
    if (!stop) throw new NotFoundException('Stop not found');

    const existingPod = await this.prisma.pod.findFirst({
      where: { stopId, tenantId },
    });

    let podStatus = dto.status;
    if (!podStatus) {
      if (dto.signatureUrl || dto.signedBy) podStatus = 'Completed' as any;
      else podStatus = 'Pending' as any;
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
            photoKeys: [], // keep consistent
          },
        });

    await this.eventLogService.logEvent(
      tenantId,
      'Stop',
      stopId,
      'POD_UPDATED',
      {
        podId: pod.id,
        status: pod.status,
        signedBy: pod.signedBy,
        signatureUrl: dto.signatureUrl,
        note: dto.note,
      },
    );

    return this.toDto(pod);
  }

  // ✅ Upload a file buffer to Supabase Storage, append key to pod.photoKeys, return signed URL
  async uploadPodPhoto(
    tenantId: string,
    stopId: string,
    file: Express.Multer.File,
    kind?: string,
  ): Promise<{ key: string; signedUrl: string; expiresInSeconds: number }> {
    // Verify stop exists
    const stop = await this.prisma.stop.findFirst({ where: { id: stopId, tenantId } });
    if (!stop) throw new NotFoundException('Stop not found');

    // Validate content type
    const mime = String(file.mimetype ?? '');
    if (!mime.startsWith('image/')) {
      throw new BadRequestException(`Only image uploads supported. Got: ${mime}`);
    }

    const k = safeKind(kind);
    const ext = guessExt(mime, file.originalname ?? 'upload.jpg');
    const filename = `${k}_${Date.now()}.${ext}`;
    const key = `${tenantId}/stops/${stopId}/${filename}`;

    const supabase = this.supabaseService.getClient();

    // Upload (upsert true so repeated demo uploads don’t die)
    const { error: uploadErr } = await supabase.storage
      .from(POD_BUCKET)
      .upload(key, file.buffer, { contentType: mime, upsert: true });

    if (uploadErr) {
      throw new BadRequestException(`Storage upload failed: ${uploadErr.message}`);
    }

    // Ensure pod row exists
    const pod = await this.prisma.pod.upsert({
      where: { id: `pod_${tenantId}_${stopId}` }, // not real id; fallback handled below
      create: {
        tenantId,
        stopId,
        status: 'Pending' as any,
        photoKeys: [key],
      },
      update: {},
    }).catch(async () => {
      // Prisma upsert by fake id won't work if id is cuid. So do proper find/create:
      const existing = await this.prisma.pod.findFirst({ where: { tenantId, stopId } });
      if (existing) {
        const current = (existing.photoKeys as any) ?? [];
        const next = Array.isArray(current) ? [...current, key] : [key];
        await this.prisma.pod.update({
          where: { id: existing.id },
          data: { photoKeys: next as any },
        });
        return existing;
      }
      const created = await this.prisma.pod.create({
        data: {
          tenantId,
          stopId,
          status: 'Pending' as any,
          photoKeys: [key],
        },
      });
      return created;
    });

    // If pod existed but upsert fallback returned existing without update, ensure append
    if (pod && pod.id) {
      const existing = await this.prisma.pod.findFirst({ where: { tenantId, stopId } });
      if (existing) {
        const current = (existing.photoKeys as any) ?? [];
        const arr = Array.isArray(current) ? current : [];
        if (!arr.includes(key)) {
          await this.prisma.pod.update({
            where: { id: existing.id },
            data: { photoKeys: [...arr, key] as any },
          });
        }
      }
    }

    // Signed URL for immediate viewing
    const { data, error: signErr } = await supabase.storage
      .from(POD_BUCKET)
      .createSignedUrl(key, SIGNED_URL_TTL_SECONDS);

    if (signErr || !data?.signedUrl) {
      throw new BadRequestException(`Signed URL failed: ${signErr?.message ?? 'unknown error'}`);
    }

    // Event log
    await this.eventLogService.logEvent(
      tenantId,
      'Stop',
      stopId,
      'POD_PHOTO_UPLOADED',
      { key, kind: k, mime },
    );

    return { key, signedUrl: data.signedUrl, expiresInSeconds: SIGNED_URL_TTL_SECONDS };
  }

  // ✅ Convert stored keys into signed URLs for display
  async getPodPhotoSignedUrls(
    tenantId: string,
    stopId: string,
  ): Promise<{ items: { key: string; signedUrl: string }[]; expiresInSeconds: number }> {
    const stop = await this.prisma.stop.findFirst({ where: { id: stopId, tenantId } });
    if (!stop) throw new NotFoundException('Stop not found');

    const pod = await this.prisma.pod.findFirst({ where: { tenantId, stopId } });
    if (!pod) return { items: [], expiresInSeconds: SIGNED_URL_TTL_SECONDS };

    const raw = (pod.photoKeys as any) ?? [];
    const keys: string[] = Array.isArray(raw) ? raw.filter(Boolean) : [];

    const supabase = this.supabaseService.getClient();

    const items: { key: string; signedUrl: string }[] = [];
    for (const key of keys) {
      const { data, error } = await supabase.storage
        .from(POD_BUCKET)
        .createSignedUrl(key, SIGNED_URL_TTL_SECONDS);

      if (!error && data?.signedUrl) {
        items.push({ key, signedUrl: data.signedUrl });
      }
    }

    return { items, expiresInSeconds: SIGNED_URL_TTL_SECONDS };
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
