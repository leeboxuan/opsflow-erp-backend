import { BadRequestException } from '@nestjs/common';
import { SupabaseService } from '../../shared/auth/supabase.service';

export const WAREHOUSE_JOB_DOCUMENTS_BUCKET = 'warehouse-job-documents';

export const WAREHOUSE_JOB_DOCUMENT_MAX_BYTES = 10 * 1024 * 1024;

const ALLOWED_EXT = /\.(pdf|xlsx|xls|csv|doc|docx|jpg|jpeg|png|webp|txt)$/i;

const ALLOWED_MIMES = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
  'application/csv',
  'text/plain',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/jpeg',
  'image/png',
  'image/webp',
]);

const EXECUTABLE_EXT = /\.(exe|bat|cmd|sh|msi|dll|js|jar|com|scr|vbs|ps1)$/i;

export function assertAllowedWarehouseJobDocumentFile(
  file: Express.Multer.File,
): void {
  if (!file?.buffer?.length) {
    throw new BadRequestException('file is required');
  }

  if ((file.size ?? 0) > WAREHOUSE_JOB_DOCUMENT_MAX_BYTES) {
    throw new BadRequestException(
      `File exceeds maximum size of ${WAREHOUSE_JOB_DOCUMENT_MAX_BYTES} bytes`,
    );
  }

  const name = String(file.originalname ?? '');
  const mime = String(file.mimetype ?? '').toLowerCase();

  if (EXECUTABLE_EXT.test(name)) {
    throw new BadRequestException('Executable file types are not allowed');
  }

  if (!ALLOWED_EXT.test(name) && !ALLOWED_MIMES.has(mime)) {
    throw new BadRequestException('Unsupported file type for warehouse job document');
  }
}

export function buildWarehouseJobDocumentStorageKey(
  tenantId: string,
  warehouseJobId: string,
  type: string,
  originalName: string,
): string {
  const ext = originalName.match(/\.[a-z0-9]+$/i)?.[0] ?? '';
  const base =
    originalName
      .replace(/\.[a-z0-9]+$/i, '')
      .replace(/[^a-zA-Z0-9._-]+/g, '-')
      .slice(0, 80) || 'document';
  return `${tenantId}/warehouse-jobs/${warehouseJobId}/${type.toLowerCase()}/${Date.now()}-${base}${ext}`;
}

export async function uploadWarehouseJobDocument(
  supabaseService: SupabaseService,
  storageKey: string,
  file: Express.Multer.File,
): Promise<void> {
  await uploadWarehouseJobDocumentBuffer(
    supabaseService,
    storageKey,
    file.buffer,
    file.mimetype ?? 'application/octet-stream',
  );
}

export async function uploadWarehouseJobDocumentBuffer(
  supabaseService: SupabaseService,
  storageKey: string,
  buffer: Buffer,
  contentType: string,
): Promise<void> {
  const supabase = supabaseService.getClient();
  const { error } = await supabase.storage
    .from(WAREHOUSE_JOB_DOCUMENTS_BUCKET)
    .upload(storageKey, buffer, {
      contentType,
      upsert: false,
    });

  if (error) {
    throw new BadRequestException(`Storage upload failed: ${error.message}`);
  }
}

export async function createWarehouseJobDocumentSignedUrl(
  supabaseService: SupabaseService,
  storageKey: string,
): Promise<string | null> {
  const key = String(storageKey ?? '').trim();
  if (!key) return null;

  const supabase = supabaseService.getClient();
  const { data, error } = await supabase.storage
    .from(WAREHOUSE_JOB_DOCUMENTS_BUCKET)
    .createSignedUrl(key, 60 * 60);

  if (error || !data?.signedUrl) {
    return null;
  }

  return data.signedUrl;
}
