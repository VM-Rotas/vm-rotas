import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateVehicleDto {
  @ApiProperty({ example: 'ABC1D23' })
  @IsString()
  @MinLength(7)
  @MaxLength(10)
  plate: string;

  @ApiProperty({ example: 'Fiorino 01' })
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name: string;

  @ApiPropertyOptional({ enum: ['AVAILABLE', 'IN_ROUTE', 'MAINTENANCE', 'INACTIVE'] })
  @IsOptional()
  @IsIn(['AVAILABLE', 'IN_ROUTE', 'MAINTENANCE', 'INACTIVE'])
  status?: 'AVAILABLE' | 'IN_ROUTE' | 'MAINTENANCE' | 'INACTIVE';

  @ApiPropertyOptional({ example: 650 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  capacityWeightKg?: number;

  @ApiPropertyOptional({ example: 3.2 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  capacityVolumeM3?: number;

  @ApiPropertyOptional({ example: '08:00' })
  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  startHour?: string;

  @ApiPropertyOptional({ example: '18:00' })
  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/)
  endHour?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
