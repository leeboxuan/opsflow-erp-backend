import { ApiProperty } from "@nestjs/swagger";
import { IsArray, IsInt, IsOptional, IsString, Min, ValidateNested } from "class-validator";
import { Type } from "class-transformer";

class ReplaceOrderItemLineDto {
  @ApiProperty()
  @IsString()
  inventoryItemId!: string;

  @ApiProperty()
  @IsInt()
  @Min(0)
  qty!: number;

  // optional: if you want to explicitly choose units
  @ApiProperty({ required: false, type: [String] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  unitSkus?: string[];
}

export class ReplaceOrderItemsDto {
  @ApiProperty({ type: [ReplaceOrderItemLineDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ReplaceOrderItemLineDto)
  items!: ReplaceOrderItemLineDto[];
}
