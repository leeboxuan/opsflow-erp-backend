import { IsArray, IsOptional, IsString } from "class-validator";

export class DispatchTripDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  unitSkus?: string[];
}