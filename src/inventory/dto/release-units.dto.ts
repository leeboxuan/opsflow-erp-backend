import { IsArray, IsString, ArrayNotEmpty } from 'class-validator';

export class ReleaseUnitsDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  unitSkus: string[];
}
