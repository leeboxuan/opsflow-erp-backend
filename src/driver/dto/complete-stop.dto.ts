import { IsArray, IsOptional, IsString, ArrayMinSize } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CompleteStopDto {
  @ApiProperty({
    example: ['uploads/pod/stop-123/photo1.jpg', 'uploads/pod/stop-123/photo2.jpg'],
    description: 'At least one POD photo key required',
    minItems: 1,
  })
  @IsArray()
  @ArrayMinSize(1, { message: 'At least one POD photo key is required' })
  @IsString({ each: true })
  podPhotoKeys: string[];

  @ApiProperty({
    example: "Left package with concierge. Customer asked to call before next delivery.",
    required: false,
  })
  @IsOptional()
  @IsString()
  comment?: string;
}
