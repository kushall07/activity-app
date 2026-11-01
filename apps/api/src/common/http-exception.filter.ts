import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { BaseExceptionFilter } from '@nestjs/core';
import type { Response } from 'express';
import { ApiException } from './errors.js';

/** Adds headers carried by ApiException (e.g. Retry-After on 429) before Nest serialises it. */
@Catch(HttpException)
export class ApiExceptionFilter extends BaseExceptionFilter implements ExceptionFilter {
  override catch(exception: HttpException, host: ArgumentsHost): void {
    if (exception instanceof ApiException && exception.headers) {
      const res = host.switchToHttp().getResponse<Response>();
      for (const [k, v] of Object.entries(exception.headers)) res.setHeader(k, v);
    }
    super.catch(exception, host);
  }
}
