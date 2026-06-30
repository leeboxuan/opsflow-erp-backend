import { ApiProperty, ApiPropertyOptional } from "@nestjs/swagger";
import {
  NotificationAudience,
  NotificationSeverity,
  Role,
} from "@prisma/client";

export class NotificationDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  tenantId!: string;

  @ApiPropertyOptional()
  userId?: string | null;

  @ApiPropertyOptional({ enum: Role })
  role?: Role | null;

  @ApiProperty({ enum: NotificationAudience })
  audience!: NotificationAudience;

  @ApiProperty()
  type!: string;

  @ApiProperty()
  title!: string;

  @ApiPropertyOptional()
  description?: string | null;

  @ApiProperty({ enum: ["info", "success", "warning", "danger"] })
  severity!: "info" | "success" | "warning" | "danger";

  @ApiPropertyOptional()
  entityType?: string | null;

  @ApiPropertyOptional()
  entityId?: string | null;

  @ApiPropertyOptional()
  jobId?: string | null;

  @ApiPropertyOptional()
  tripId?: string | null;

  @ApiPropertyOptional()
  driverUserId?: string | null;

  @ApiPropertyOptional()
  readAt?: Date | null;

  @ApiPropertyOptional({
    description: "Per-user read flag (from NotificationRecipient)",
  })
  read?: boolean;

  @ApiProperty()
  createdAt!: Date;

  @ApiPropertyOptional({
    description:
      "Display-ready context (jobInternalRef, tripDisplayRef, customerCompanyName, displayType, etc.)",
  })
  metadata?: Record<string, unknown> | null;
}

export class NotificationsListResponseDto {
  @ApiProperty({ type: [NotificationDto] })
  data!: NotificationDto[];

  @ApiPropertyOptional({
    description: "Pass as ?cursor= on the next request when more items exist",
  })
  nextCursor?: string | null;
}

export class UnreadCountResponseDto {
  @ApiProperty()
  unreadCount!: number;
}

export class MarkAllReadResponseDto {
  @ApiProperty()
  markedCount!: number;
}
