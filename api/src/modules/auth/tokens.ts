import { SignJWT, jwtVerify, decodeJwt, errors } from 'jose';
import type { Config } from '../../config.js';
import { AppError } from '../../lib/errors.js';

const ISSUER = 'orbita-api';

export interface TokenService {
  sign(userId: string): Promise<{ token: string; expiresIn: number }>;
  verify(token: string): Promise<string>;
}

/** JWT HS256 firmado con JWT_SECRET. El id de usuario viaja en `sub`. */
export function createTokenService(config: Config): TokenService {
  const key = new TextEncoder().encode(config.JWT_SECRET);

  return {
    async sign(userId) {
      const token = await new SignJWT({})
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(userId)
        .setIssuer(ISSUER)
        .setIssuedAt()
        .setExpirationTime(config.JWT_EXPIRES_IN)
        .sign(key);
      const { exp = 0, iat = 0 } = decodeJwt(token);
      return { token, expiresIn: exp - iat };
    },

    async verify(token) {
      try {
        const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'], issuer: ISSUER });
        if (!payload.sub) throw new Error('sin sub');
        return payload.sub;
      } catch (err) {
        if (err instanceof errors.JWTExpired) {
          throw new AppError(401, 'TOKEN_EXPIRED', 'Tu sesión expiró. Inicia sesión de nuevo.');
        }
        throw new AppError(401, 'INVALID_TOKEN', 'El token de acceso no es válido.');
      }
    },
  };
}
