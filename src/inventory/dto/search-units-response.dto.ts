import { ApiProperty } from '@nestjs/swagger';

export class SearchUnitsResponseDto<T = any> {
  @ApiProperty({ isArray: true })
  rows!: T[];

  @ApiProperty({ nullable: true, example: 'ckxyz...' })
  nextCursor!: string | null;

  @ApiProperty({ example: true })
  hasMore!: boolean;

  @ApiProperty({ example: 187 })
  totalCount!: number;
}
