import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { ZodError } from 'zod';
import { AppError, errorBody } from '../lib/errors.js';

/** Formato único de error: { error: { code, message, details? } } */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');

  catch(err: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();

    if (err instanceof AppError) {
      res.status(err.statusCode).json(errorBody(err.code, err.message, err.details));
      return;
    }
    if (err instanceof ZodError) {
      const details = err.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
      res.status(400).json(errorBody('VALIDATION_ERROR', details[0]?.message ?? 'Datos inválidos', details));
      return;
    }

    // HttpException de Nest (404 de rutas) o errores de body-parser (JSON inválido, body muy grande).
    const e = err as { status?: number; statusCode?: number; type?: string; message?: string };
    const status = err instanceof HttpException ? err.getStatus() : (e.status ?? e.statusCode);
    if (status && status < 500) {
      if (e.type === 'entity.parse.failed') {
        res.status(400).json(errorBody('INVALID_JSON', 'El cuerpo de la solicitud no es un JSON válido.'));
      } else if (e.type === 'entity.too.large') {
        res.status(413).json(errorBody('PAYLOAD_TOO_LARGE', 'El cuerpo de la solicitud es demasiado grande.'));
      } else if (status === 404) {
        res.status(404).json(errorBody('NOT_FOUND', 'Ruta no encontrada'));
      } else {
        res.status(status).json(errorBody('BAD_REQUEST', e.message ?? 'Solicitud inválida'));
      }
      return;
    }

    this.logger.error(err);
    res.status(500).json(errorBody('INTERNAL_ERROR', 'Error interno del servidor'));
  }
}
