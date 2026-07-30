import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsPostalCode,
  IsString,
  Length,
  Max,
  Min,
  MinLength,
} from 'class-validator';

export class CreateOrderDto {
  @ApiPropertyOptional({ example: 'PED-000123' })
  @IsOptional()
  @IsString()
  @MinLength(2)
  code?: string;

  @ApiPropertyOptional({ example: 'ML-2000000000' })
  @IsOptional()
  @IsString()
  externalReference?: string;

  @ApiProperty({ enum: ['DELIVERY', 'PICKUP'], example: 'DELIVERY' })
  @IsIn(['DELIVERY', 'PICKUP'])
  type: 'DELIVERY' | 'PICKUP';

  @ApiPropertyOptional({ enum: ['PLANNED', 'READY'], default: 'READY' })
  @IsOptional()
  @IsIn(['PLANNED', 'READY'])
  status?: 'PLANNED' | 'READY';

  @ApiPropertyOptional({ enum: ['LOW', 'NORMAL', 'HIGH', 'URGENT'], default: 'NORMAL' })
  @IsOptional()
  @IsIn(['LOW', 'NORMAL', 'HIGH', 'URGENT'])
  priority?: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';

  @ApiProperty({ example: '2026-07-30' })
  @IsString()
  @Length(10, 10)
  plannedDate: string;

  @ApiPropertyOptional({ example: '2026-07-30T12:00:00.000Z' })
  @IsOptional()
  @IsISO8601()
  timeWindowStart?: string;

  @ApiPropertyOptional({ example: '2026-07-30T15:00:00.000Z' })
  @IsOptional()
  @IsISO8601()
  timeWindowEnd?: string;

  @ApiPropertyOptional({ default: 10 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(480)
  serviceDurationMin?: number;

  @ApiPropertyOptional({ example: 25.5 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  weightKg?: number;

  @ApiPropertyOptional({ example: 0.12 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  volumeM3?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  customerId?: string;

  @ApiPropertyOptional({ example: 'Cliente Exemplo Ltda.' })
  @IsOptional()
  @IsString()
  customerName?: string;

  @ApiProperty({ example: 'Maria da Silva' })
  @IsString()
  @MinLength(2)
  recipientName: string;

  @ApiPropertyOptional({ example: '(43) 99999-9999' })
  @IsOptional()
  @IsString()
  recipientPhone?: string;

  @ApiProperty({ example: 'Rua das Flores' })
  @IsString()
  @MinLength(2)
  addressLine: string;

  @ApiPropertyOptional({ example: '120' })
  @IsOptional()
  @IsString()
  addressNumber?: string;

  @ApiPropertyOptional({ example: 'Fundos' })
  @IsOptional()
  @IsString()
  addressComplement?: string;

  @ApiPropertyOptional({ example: 'Centro' })
  @IsOptional()
  @IsString()
  neighborhood?: string;

  @ApiProperty({ example: 'São Pedro do Ivaí' })
  @IsString()
  @MinLength(2)
  city: string;

  @ApiProperty({ example: 'PR' })
  @IsString()
  @Length(2, 2)
  state: string;

  @ApiPropertyOptional({ example: '86945-000' })
  @IsOptional()
  @IsPostalCode('BR')
  postalCode?: string;

  @ApiPropertyOptional({ example: -23.865 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude?: number;

  @ApiPropertyOptional({ example: -51.856 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  notes?: string;
}
