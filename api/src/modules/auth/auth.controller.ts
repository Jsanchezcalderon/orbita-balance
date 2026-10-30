import { Body, Controller, HttpCode, Inject, Post } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { POOL, TOKENS } from '../../common/tokens.js';
import type { Pool } from '../../db/pool.js';
import { ApiDocs, loginSchema as loginDocs } from '../../docs/openapi.js';
import { AppError } from '../../lib/errors.js';
import type { TokenService } from './tokens.js';

const loginSchema = z.object({
  email: z.string({ required_error: 'El correo es obligatorio' }).min(1, 'El correo es obligatorio'),
  password: z
    .string({ required_error: 'La contraseña es obligatoria' })
    .min(1, 'La contraseña es obligatoria'),
});

// Hash de relleno: si el email no existe igual se ejecuta bcrypt.compare,
// así el tiempo de respuesta no revela si la cuenta existe.
const DUMMY_HASH = bcrypt.hashSync('orbita-dummy-password', 10);

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(POOL) private readonly pool: Pool,
    @Inject(TOKENS) private readonly tokens: TokenService,
  ) {}

  @Post('login')
  @HttpCode(200)
  @ApiDocs(loginDocs)
  async login(@Body() body: unknown) {
    const { email, password } = loginSchema.parse(body);

    const { rows } = await this.pool.query<{ id: string; password_hash: string }>(
      'SELECT id, password_hash FROM users WHERE email = $1',
      [email.trim().toLowerCase()],
    );
    const user = rows[0];
    const passwordOk = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH);

    if (!user || !passwordOk) {
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Correo o contraseña incorrectos.');
    }

    const { token, expiresIn } = await this.tokens.sign(user.id);
    return { access_token: token, token_type: 'Bearer', expires_in: expiresIn };
  }
}
