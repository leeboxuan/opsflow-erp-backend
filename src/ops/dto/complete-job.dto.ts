import { ApiProperty } from "@nestjs/swagger";
import { IsString, MinLength } from "class-validator";

export class DriverCompleteJobDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  recipientName: string;
}
