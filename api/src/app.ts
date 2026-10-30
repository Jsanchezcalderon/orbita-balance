import 'reflect-metadata';
import { Controller, Get, type INestApplication, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AllExceptionsFilter } from './common/all-exceptions.filter.js';
import { AuthGuard } from './common/auth.guard.js';import { CONFIG, POOL, TOKENS } from './common/tokens.js';
import type { Config } from './config.js';
import type { Pool } from './db/pool.js';
import { ApiDocs, healthSchema, setupDocs } from './docs/openapi.js';
import { AuthController } from './modules/auth/auth.controller.js';
import { createTokenService } from './modules/auth/tokens.js';
import { BalancesController } from './modules/balances/balances.controller.js';
import { WebhooksController } from './modules/webhooks/webhooks.controller.js';

export interface BuildAppOptions {
  config: Config;
  pool: Pool;
  logger?: boolean;
}

@Controller('health')
class HealthController {
  @Get()
  @ApiDocs(healthSchema)
  health() {
    return { status: 'ok' };
  }
}

export async function buildApp({ config, pool, logger = true }: BuildAppOptions): Promise<INestApplication> {
  @Module({
    controllers: [HealthController, AuthController, BalancesController, WebhooksController],
    providers: [
      AuthGuard,
      { provide: CONFIG, useValue: config },
      { provide: POOL, useValue: pool },
      { provide: TOKENS, useFactory: () => createTokenService(config) },
    ],
  })
  class AppModule {}

  // rawBody: conserva el body crudo para validar la firma del webhook.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
    logger: logger ? ['log', 'warn', 'error'] : false,
  });
  app.useBodyParser('json', { limit: '100kb' });
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableCors({ origin: config.CORS_ORIGIN.split(',').map((o) => o.trim()) });
  setupDocs(app);
  return app;
}
