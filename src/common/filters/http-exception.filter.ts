import {
  ExceptionFilter,
  Catch,
  ArgumentsHost,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

@Catch()
export class GlobalHttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalHttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const exceptionResponse =
      exception instanceof HttpException ? exception.getResponse() : null;

    let message: string | string[] = 'Internal server error';
    let errorType = 'InternalServerError';

    if (exception instanceof HttpException) {
      errorType = exception.name || 'HttpException';
      if (typeof exceptionResponse === 'object' && exceptionResponse !== null) {
        message = (exceptionResponse as any).message || String(exception);
      } else if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
      } else {
        message = exception.message;
      }
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    // Specific mapping for Sprint 1.1 Gatekeeping Exceptions
    if (status === HttpStatus.PAYLOAD_TOO_LARGE) {
      errorType = 'PayloadTooLarge';
    } else if (status === HttpStatus.UNSUPPORTED_MEDIA_TYPE) {
      errorType = 'UnsupportedMediaType';
    } else if (status === HttpStatus.BAD_REQUEST) {
      errorType = 'BadRequest';
    }

    if (status === HttpStatus.INTERNAL_SERVER_ERROR) {
      this.logger.error(
        `[${request.method}] ${request.url} - Error: ${JSON.stringify(message)}`,
        exception instanceof Error ? exception.stack : '',
      );
    } else {
      this.logger.warn(`[${request.method}] ${request.url} - Status ${status} (${errorType}): ${JSON.stringify(message)}`);
    }

    response.status(status).json({
      success: false,
      statusCode: status,
      errorType,
      message,
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }
}
