import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class CreateUserDto {
  @ApiProperty({ example: 'Operador de Tráfego' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @ApiProperty({ example: 'operacao@empresa.com.br' })
  @IsEmail()
  email: string;

  @ApiProperty({ minLength: 8 })
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password: string;

  @ApiProperty({ enum: ['OWNER', 'ADMIN', 'DISPATCHER', 'DRIVER', 'VIEWER'] })
  @IsIn(['OWNER', 'ADMIN', 'DISPATCHER', 'DRIVER', 'VIEWER'])
  role: 'OWNER' | 'ADMIN' | 'DISPATCHER' | 'DRIVER' | 'VIEWER';

  @ApiPropertyOptional({
    description: 'Veículo fixo da conta motorista. Somente perfis DRIVER podem receber este vínculo.',
    nullable: true,
  })
  @IsOptional()
  @IsUUID()
  assignedVehicleId?: string | null;

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
