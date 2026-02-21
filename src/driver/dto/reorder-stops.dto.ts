import { IsArray, IsString } from "class-validator";

export class ReorderStopsDto {
  @IsArray()
  @IsString({ each: true })
  stopIds!: string[];
}