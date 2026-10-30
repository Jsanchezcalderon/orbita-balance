import { type CanActivate, type ExecutionContext, Inject, Injectable, createParamDecorator } from '@nestjs/common';
import type { Request } from 'express';
import { AppError } from '../lib/errors.js';
import type { TokenService } from '../modules/auth/tokens.js';
import { TOKENS } from './tokens.js';

declare module 'express' {
  interface Request {
    /** Siempre sale del token; nunca del body ni de headers de usuario. */
    userId: string;
  }
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(TOKENS) private readonly tokens: TokenService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<Request>();
    const match = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? '');
    if (!match?.[1]) {
      throw new AppError(401, 'UNAUTHORIZED', 'Falta el token de acceso.');
    }
    req.userId = await this.tokens.verify(match[1]);
    return true;
  }
}

/** Id del usuario autenticado (viene del token). */
export const UserId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => ctx.switchToHttp().getRequest<Request>().userId,
);
