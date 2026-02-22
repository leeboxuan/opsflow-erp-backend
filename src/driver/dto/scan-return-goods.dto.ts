import { ApiProperty } from "@nestjs/swagger";
import { IsArray, IsIn, IsString, ArrayMinSize } from "class-validator";

export class ScanReturnGoodsDto {
  @ApiProperty({
    example: ["UNIT-000123", "UNIT-000124"],
    description: "Scanned unitSku(s)",
    minItems: 1,
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsString({ each: true })
  unitSkus: string[];

  @ApiProperty({
    example: "Damaged",
    enum: ["Damaged", "ReturnToWarehouse", "Returned"],
  })
  @IsIn(["Damaged", "ReturnToWarehouse", "Returned"])
  disposition: "Damaged" | "ReturnToWarehouse" | "Returned";
}
