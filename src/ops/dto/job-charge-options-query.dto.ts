import { ApiProperty } from "@nestjs/swagger";
import { IsString, MinLength } from "class-validator";

export class JobChargeOptionsQueryDto {
  @ApiProperty({
    description: "Customer company id used to resolve pre-create charge options",
  })
  @IsString()
  @MinLength(1)
  customerCompanyId: string;
}
