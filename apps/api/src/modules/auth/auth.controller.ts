import { Body, Controller, Get, Post, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import type { AuthUser } from '../../common/types/auth-user';
import { AUTH_COOKIE_NAME, AUTH_TOKEN_TTL_SECONDS } from './auth.constants';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Post('login')
  @ApiOperation({ summary: 'Autentica um usuário no sistema web' })
  async login(
    @Body() dto: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ): Promise<{ user: AuthUser }> {
    const result = await this.authService.login(dto);
    const secure = this.config.get<boolean>('COOKIE_SECURE', false);

    response.cookie(AUTH_COOKIE_NAME, result.token, {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: '/',
      maxAge: AUTH_TOKEN_TTL_SECONDS * 1000,
    });

    return { user: result.user };
  }

  @Public()
  @Post('mobile-login')
  @ApiOperation({ summary: 'Autentica o aplicativo Android do motorista' })
  mobileLogin(@Body() dto: LoginDto): Promise<{ accessToken: string; user: AuthUser }> {
    return this.authService.mobileLogin(dto);
  }

  @Post('logout')
  @ApiCookieAuth(AUTH_COOKIE_NAME)
  @ApiOperation({ summary: 'Encerra a sessão' })
  logout(@Res({ passthrough: true }) response: Response): { success: true } {
    const secure = this.config.get<boolean>('COOKIE_SECURE', false);

    response.clearCookie(AUTH_COOKIE_NAME, {
      httpOnly: true,
      secure,
      sameSite: 'lax',
      path: '/',
    });

    return { success: true };
  }

  @Get('me')
  @ApiCookieAuth(AUTH_COOKIE_NAME)
  @ApiOperation({ summary: 'Retorna o usuário autenticado' })
  me(@CurrentUser() user: AuthUser): { user: AuthUser } {
    return { user };
  }
}
