import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class ListOrdersQueryDto {
  @ApiPropertyOptional({ example: '2026-07-30' })
  @IsOptional()
  @IsString()
  @Length(10, 10)
  date?: string;

  @ApiPropertyOptional({
    enum: ['PLANNED', 'READY', 'ROUTED', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'CANCELLED'],
  })
  @IsOptional()
  @IsIn(['PLANNED', 'READY', 'ROUTED', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'CANCELLED'])
  status?:
    | 'PLANNED'
    | 'READY'
    | 'ROUTED'
    | 'IN_PROGRESS'
    | 'COMPLETED'
    | 'FAILED'
    | 'CANCELLED';

  @ApiPropertyOptional({ enum: ['LOW', 'NORMAL', 'HIGH', 'URGENT'] })
  @IsOptional()
  @IsIn(['LOW', 'NORMAL', 'HIGH', 'URGENT'])
  priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ default: 100, maximum: 500 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  take = 100;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip = 0;
}
