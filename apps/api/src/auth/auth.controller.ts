import { Body, Controller, HttpCode, Post, Req, Res } from '@nestjs/common';
import type { CookieOptions, Request, Response } from 'express';
import { env } from '../config/env';
import { Idempotent } from '../common/idempotency';
import { ZodPipe } from '../common/zod.pipe';
import { Public } from './decorators';
import { LoginDto, LoginSchema, RegisterDto, RegisterSchema } from './auth.schemas';
import { AuthService, SessionBody } from './auth.service';

const COOKIE = 'refresh_token';

function cookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: `${env.API_BASE_PATH}/auth`, // sent only to /auth/* endpoints
    maxAge: env.JWT_REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000,
  };
}

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Idempotent()
  @Post('register')
  async register(@Body(new ZodPipe(RegisterSchema)) dto: RegisterDto, @Res({ passthrough: true }) res: Response): Promise<SessionBody> {
    const { session, refreshToken } = await this.auth.register(dto);
    res.cookie(COOKIE, refreshToken, cookieOptions());
    return session;
  }

  @Public()
  @HttpCode(200)
  @Post('login')
  async login(
    @Body(new ZodPipe(LoginSchema)) dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<SessionBody> {
    const { session, refreshToken } = await this.auth.login(dto, req.ip);
    res.cookie(COOKIE, refreshToken, cookieOptions());
    return session;
  }

  @Public()
  @HttpCode(200)
  @Post('refresh')
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<SessionBody> {
    const { session, refreshToken } = await this.auth.refresh(req.cookies?.[COOKIE]);
    res.cookie(COOKIE, refreshToken, cookieOptions());
    return session;
  }

  /** Not in the Phase 1 OpenAPI draft: added so the web app can sign out. Proposed as an addition to docs/openapi.yaml. */
  @Public()
  @HttpCode(204)
  @Post('logout')
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logout(req.cookies?.[COOKIE]);
    res.clearCookie(COOKIE, { ...cookieOptions(), maxAge: undefined });
  }
}