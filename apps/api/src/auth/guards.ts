import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import type { Role } from '../common/auth.types';
import { forbidden, unauthorized } from '../common/errors';
import { IS_PUBLIC, ROLES } from './decorators';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [ctx.getHandler(), ctx.getClass()])) return true;

    const req = ctx.switchToHttp().getRequest<Request>();
    const [scheme, token] = (req.headers.authorization ?? '').split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !token) {
      throw unauthorized('UNAUTHORIZED', 'Missing bearer token');
    }
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; role: Role }>(token, { algorithms: ['HS256'] });
      req.user = { id: payload.sub, role: payload.role };
      return true;
    } catch {
      throw unauthorized('INVALID_TOKEN', 'Access token is invalid or expired');
    }
  }
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const roles = this.reflector.getAllAndOverride<Role[] | undefined>(ROLES, [ctx.getHandler(), ctx.getClass()]);
    if (!roles || roles.length === 0) return true;
    const user = ctx.switchToHttp().getRequest<Request>().user;
    if (!user || !roles.includes(user.role)) throw forbidden('FORBIDDEN', 'You do not have permission to do this');
    return true;
  }
}