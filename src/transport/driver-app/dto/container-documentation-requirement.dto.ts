import { ApiProperty } from "@nestjs/swagger";
import { TripDocumentType } from "@prisma/client";

export class ContainerDocumentationRequirementDto {
  @ApiProperty()
  jobItemId!: string;

  @ApiProperty({ nullable: true })
  containerNumber!: string | null;

  @ApiProperty({ nullable: true })
  sealNumber!: string | null;

  @ApiProperty()
  hasContainerPhoto!: boolean;

  @ApiProperty()
  hasSealPhoto!: boolean;

  @ApiProperty({
    enum: [TripDocumentType.CONTAINER_PHOTO, TripDocumentType.SEAL_PHOTO],
    isArray: true,
  })
  missing!: Array<
    typeof TripDocumentType.CONTAINER_PHOTO | typeof TripDocumentType.SEAL_PHOTO
  >;
}
