import { Body, Controller, Get, Headers, Inject, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { z } from 'zod';
import { AuthGuard, UserId } from '../../common/auth.guard.js';
import { POOL } from '../../common/tokens.js';
import type { Pool } from '../../db/pool.js';
import {
  ApiDocs,
  depositSchema,
  getBalanceSchema,
  listTransactionsSchema,
  withdrawalSchema,
} from '../../docs/openapi.js';
import { AppError } from '../../lib/errors.js';
import { moneyBodySchema } from '../../lib/money.js';
import { applyOperation, getBalance, listTransactions, type OperationKind } from './service.js';

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

function readIdempotencyKey(raw: string | string[] | undefined): string {
  const key = (Array.isArray(raw) ? raw[0] : raw)?.trim();
  if (!key) {
    throw new AppError(400, 'IDEMPOTENCY_KEY_REQUIRED', 'Falta el header Idempotency-Key.');
  }
  if (key.length > 255) {
    throw new AppError(400, 'IDEMPOTENCY_KEY_INVALID', 'Idempotency-Key admite máximo 255 caracteres.');
  }
  return key;
}

@Controller('balances/me')
@UseGuards(AuthGuard)
export class BalancesController {
  constructor(@Inject(POOL) private readonly pool: Pool) {}

  @Get()
  @ApiDocs(getBalanceSchema)
  balance(@UserId() userId: string) {
    return getBalance(this.pool, userId);
  }

  @Get('transactions')
  @ApiDocs(listTransactionsSchema)
  transactions(@UserId() userId: string, @Query() query: unknown) {
    const { page, limit } = listQuerySchema.parse(query);
    return listTransactions(this.pool, userId, page, limit);
  }

  @Post('deposits')
  @ApiDocs(depositSchema)
  deposit(
    @UserId() userId: string,
    @Headers('idempotency-key') key: string | string[] | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.operate('deposit', userId, key, body, res);
  }

  @Post('withdrawals')
  @ApiDocs(withdrawalSchema)
  withdrawal(
    @UserId() userId: string,
    @Headers('idempotency-key') key: string | string[] | undefined,
    @Body() body: unknown,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.operate('withdrawal', userId, key, body, res);
  }

  private async operate(
    kind: OperationKind,
    userId: string,
    rawKey: string | string[] | undefined,
    body: unknown,
    res: Response,
  ) {
    const idempotencyKey = readIdempotencyKey(rawKey);
    // strict(): rechaza campos extra como `user_id`. El usuario sale solo del token.
    const { amount: cents } = moneyBodySchema.parse(body);
    const result = await applyOperation(this.pool, { userId, kind, cents, idempotencyKey });
    if (result.replayed) res.setHeader('Idempotent-Replayed', 'true');
    res.status(result.status);
    return result.body;
  }
}
