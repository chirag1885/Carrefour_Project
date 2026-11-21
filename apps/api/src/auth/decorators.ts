import { SetMetadata, createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';
import type { AuthUser, Role } from '../common/auth.types';

export const IS_PUBLIC = 'isPublic';
export const ROLES = 'roles';

/** Route needs no access token. Every route is protected unless marked @Public(). */
export const Public = () => SetMetadata(IS_PUBLIC, true);
/** Route requires one of these roles (checked after authentication). */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);

export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  return ctx.switchToHttp().getRequest<Request>().user as AuthUser;
});