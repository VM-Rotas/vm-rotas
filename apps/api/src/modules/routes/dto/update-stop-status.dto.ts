import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateStopStatusDto {
  @ApiProperty({ enum: ['EN_ROUTE', 'ARRIVED', 'COMPLETED', 'FAILED', 'SKIPPED'] })
  @IsIn(['EN_ROUTE', 'ARRIVED', 'COMPLETED', 'FAILED', 'SKIPPED'])
  status: 'EN_ROUTE' | 'ARRIVED' | 'COMPLETED' | 'FAILED' | 'SKIPPED';

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
