-- Add standardized tenant-level quotation master file type
ALTER TYPE "MasterFileType" ADD VALUE IF NOT EXISTS 'QUOTATION';
