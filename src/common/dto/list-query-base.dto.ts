import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import {
  SORT_DIR_VALUES,
  DEFAULT_LIST_PAGE,
  DEFAULT_LIST_PAGE_SIZE,
  MAX_PAGE,
  MAX_PAGE_SIZE,
} from '../constants';

/**
 * Base DTO for paginated list endpoints.
 * Provides standard query params (q, filter, sortBy, sortDir, page, pageSize)
 * so the frontend can send them consistently without 400 from forbidNonWhitelisted.
 * Extend this and add module-specific fields (e.g. search, status, date).
 */
export abstract class ListQueryBaseDto {
  @ApiPropertyOptional({ description: 'Generic search query' })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({ description: 'Generic filter' })
  @IsOptional()
  @IsString()
  filter?: string;

  @ApiPropertyOptional({ description: 'Sort field' })
  @IsOptional()
  @IsString()
  sortBy?: string;

  @ApiPropertyOptional({ enum: SORT_DIR_VALUES, description: 'Sort direction' })
  @IsOptional()
  @IsIn(SORT_DIR_VALUES)
  sortDir?: (typeof SORT_DIR_VALUES)[number];

  @ApiPropertyOptional({ default: DEFAULT_LIST_PAGE, minimum: 1, maximum: MAX_PAGE })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE)
  page?: number = DEFAULT_LIST_PAGE;

  @ApiPropertyOptional({ default: DEFAULT_LIST_PAGE_SIZE, minimum: 1, maximum: MAX_PAGE_SIZE })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  pageSize?: number = DEFAULT_LIST_PAGE_SIZE;
}
