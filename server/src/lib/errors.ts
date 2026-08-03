/**
 * The one error type the application throws deliberately. Anything else reaching the
 * error middleware is a bug and is reported as a 500 without detail.
 */
export class AppError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    if (details !== undefined) {
      this.details = details;
    }
  }

  static badRequest(message: string, details?: unknown): AppError {
    return new AppError(400, 'BAD_REQUEST', message, details);
  }

  static notFound(message = 'That record does not exist.'): AppError {
    return new AppError(404, 'NOT_FOUND', message);
  }

  static conflict(message: string, details?: unknown): AppError {
    return new AppError(409, 'CONFLICT', message, details);
  }

  /**
   * For rules the data model cannot express — a transaction whose currency doesn't match
   * its account, a category nested two levels deep, a transfer to the same account.
   */
  static unprocessable(message: string, details?: unknown): AppError {
    return new AppError(422, 'UNPROCESSABLE', message, details);
  }
}

export interface ErrorBody {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}
