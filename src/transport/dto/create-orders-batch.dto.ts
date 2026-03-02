import { Type } from "class-transformer";
import { IsArray, ValidateNested, ArrayMinSize } from "class-validator";
import { CreateOrderDto } from "./create-order.dto";

export class CreateOrdersBatchDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateOrderDto)
  orders!: CreateOrderDto[];
}