import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Length } from 'class-validator';

export class ListRoutesQueryDto {
  @ApiPropertyOptional({ example: '2026-07-30' })
  @IsOptional()
  @IsString()
  @Length(10, 10)
  date?: string;

  @ApiPropertyOptional({
    enum: ['DRAFT', 'OPTIMIZED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'SUPERSEDED'],
  })
  @IsOptional()
  @IsIn(['DRAFT', 'OPTIMIZED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'SUPERSEDED'])
  status?: 'DRAFT' | 'OPTIMIZED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'SUPERSEDED';
}
