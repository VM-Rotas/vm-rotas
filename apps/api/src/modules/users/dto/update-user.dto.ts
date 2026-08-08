import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class UpdateUserDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ example: 'usuario@empresa.com.br' })
  @IsOptional()
  @IsEmail()
  @MaxLength(180)
  email?: string;

  @ApiPropertyOptional({ enum: ['OWNER', 'ADMIN', 'DISPATCHER', 'DRIVER', 'VIEWER'] })
  @IsOptional()
  @IsIn(['OWNER', 'ADMIN', 'DISPATCHER', 'DRIVER', 'VIEWER'])
  role?: 'OWNER' | 'ADMIN' | 'DISPATCHER' | 'DRIVER' | 'VIEWER';


  @ApiPropertyOptional({
    description: 'Veículo fixo da conta motorista. Use null para remover o vínculo.',
    nullable: true,
  })
  @IsOptional()
  @IsUUID()
  assignedVehicleId?: string | null;

  @ApiPropertyOptional({ minLength: 8 })
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
