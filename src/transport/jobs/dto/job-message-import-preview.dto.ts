import { ApiProperty } from "@nestjs/swagger";
import { IsEnum, IsString, MaxLength } from "class-validator";
import { JobMessageImportSourceChannel } from "@prisma/client";

export class JobMessageImportPreviewRequestDto {
  @ApiProperty({ description: "IANA timezone string, e.g. Asia/Singapore" })
  @IsString()
  timezone!: string;

  @ApiProperty({ enum: ["WHATSAPP"], default: "WHATSAPP" })
  @IsEnum(JobMessageImportSourceChannel)
  sourceChannel!: JobMessageImportSourceChannel;

  @ApiProperty({ description: "Untrusted operational message text", maxLength: 20000 })
  @IsString()
  @MaxLength(20000)
  sourceText!: string;
}
