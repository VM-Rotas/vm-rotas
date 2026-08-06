import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { compare } from 'bcryptjs';
import type { AuthUser } from '../../common/types/auth-user';
import { PrismaService } from '../prisma/prisma.service';
import {
  AUTH_TOKEN_TTL_SECONDS,
  MOBILE_AUTH_TOKEN_TTL_SECONDS,
} from './auth.constants';
import type { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async login(dto: LoginDto): Promise<{ token: string; user: AuthUser }> {
    return this.authenticate(dto, AUTH_TOKEN_TTL_SECONDS);
  }

  async mobileLogin(dto: LoginDto): Promise<{ accessToken: string; user: AuthUser }> {
    const result = await this.authenticate(dto, MOBILE_AUTH_TOKEN_TTL_SECONDS);
    return { accessToken: result.token, user: result.user };
  }

  private async authenticate(
    dto: LoginDto,
    expiresIn: number,
  ): Promise<{ token: string; user: AuthUser }> {
    const email = dto.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });

    if (!user || !user.active || !(await compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('E-mail ou senha inválidos.');
    }

    const authUser: AuthUser = {
      sub: user.id,
      organizationId: user.organizationId,
      email: user.email,
      name: user.name,
      role: user.role,
    };

    const token = await this.jwt.signAsync(authUser, { expiresIn });

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    return { token, user: authUser };
  }
}
