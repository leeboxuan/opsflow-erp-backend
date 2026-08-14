import { ApiProperty, IntersectionType, OmitType } from "@nestjs/swagger";
import { Type } from "class-transformer";
import { IsArray, IsString, ValidateNested } from "class-validator";
import { JobMessageImportPatchDraftDto } from "./job-message-import-patch-draft.dto";

class JobMessageImportConfirmDraftIdDto {
  @ApiProperty({ description: "Draft id within the import batch" })
  @IsString()
  draftId!: string;
}

export class JobMessageImportConfirmDraftDto extends IntersectionType(
  JobMessageImportConfirmDraftIdDto,
  OmitType(JobMessageImportPatchDraftDto, ["expectedDraftVersion", "inclusionState"] as const),
) {}

export class JobMessageImportConfirmRequestDto {
  @ApiProperty({
    type: [JobMessageImportConfirmDraftDto],
    description:
      "Final reviewed values for each draft to create. Drafts omitted from this list are not created.",
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => JobMessageImportConfirmDraftDto)
  drafts!: JobMessageImportConfirmDraftDto[];
}
