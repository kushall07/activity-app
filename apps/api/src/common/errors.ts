import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Error with a stable machine-readable `code` the mobile app can switch on,
 * plus a human message it can show as-is.
 */
export class ApiException extends HttpException {
  constructor(status: HttpStatus, code: string, message: string, headers?: Record<string, string>) {
    super({ statusCode: status, code, message }, status);
    this.headers = headers;
  }
  readonly headers?: Record<string, string>;
}
