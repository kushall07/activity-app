import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { Request } from 'express';

export const IS_PUBLIC = 'auth:isPublic';
/** Opts a route out of the global auth guard. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

export interface AuthUser {
  id: string;
  sub: string;
  phone: string;
  createdAt: Date;
}

export type AuthedRequest = Request & { user?: AuthUser };

/** The signed-in user resolved by AuthGuard. */
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext): AuthUser => {
  const user = ctx.switchToHttp().getRequest<AuthedRequest>().user;
  if (!user) throw new Error('CurrentUser used on a route without AuthGuard');
  return user;
});
