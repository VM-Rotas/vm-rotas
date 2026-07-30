import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

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

  @ApiPropertyOptional({ default: true })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
