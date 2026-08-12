import { ApiProperty } from "@nestjs/swagger";
import { IsArray, IsInt, IsString, ValidateNested } from "class-validator";
import { Type } from "class-transformer";

export class JobMessageImportConfirmDraftSelectionDto {
  @ApiProperty({ description: "Draft id within the import batch" })
  @IsString()
  draftId!: string;

  @ApiProperty({ description: "Expected draft optimistic concurrency version" })
  @IsInt()
  expectedDraftVersion!: number;
}

export class JobMessageImportConfirmRequestDto {
  @ApiProperty({ description: "Expected batch version for optimistic concurrency" })
  @IsInt()
  expectedBatchVersion!: number;

  @ApiProperty({
    type: [JobMessageImportConfirmDraftSelectionDto],
    description: "Must include every currently INCLUDED draft with its current version.",
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => JobMessageImportConfirmDraftSelectionDto)
  selectedDrafts!: JobMessageImportConfirmDraftSelectionDto[];
}
