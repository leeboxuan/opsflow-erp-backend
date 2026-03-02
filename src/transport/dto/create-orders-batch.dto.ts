import { Type } from "class-transformer";
import { IsArray, ValidateNested, ArrayMinSize, IsOptional, IsString } from "class-validator";
import { CreateOrderDto } from "./create-order.dto";

export class CreateOrdersBatchDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateOrderDto)
  orders!: CreateOrderDto[];

  @IsOptional()
  @IsString()
  customerCompanyId?: string;
}