import { ApiProperty } from "@nestjs/swagger";
import { IsString, Matches } from "class-validator";

export class DriverHomeQueryDto {
  @ApiProperty({ description: "Calendar day for Today's Run (YYYY-MM-DD)", example: "2026-05-25" })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: "date must be YYYY-MM-DD" })
  date!: string;
}
