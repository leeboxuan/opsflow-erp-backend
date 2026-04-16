import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import { MasterFileStatus, MasterFileType } from "@prisma/client";

export class MasterFileDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: MasterFileType })
  type!: MasterFileType;

  @ApiProperty()
  fileName!: string;

  @ApiProperty()
  fileUrl!: string;

  @ApiPropertyOptional()
  uploadedByUserId!: string | null;

  @ApiPropertyOptional()
  customerCompanyId!: string | null;

  @ApiProperty()
  uploadedAt!: Date;

  @ApiPropertyOptional()
  effectiveDate!: Date | null;

  @ApiProperty({ enum: MasterFileStatus })
  status!: MasterFileStatus;

  @ApiPropertyOptional()
  parseSummaryJson!: Record<string, unknown> | null;

  @ApiProperty()
  isActive!: boolean;
}
