import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { ErrorCode } from '@torta/shared';

export class ApiError extends Error {
  constructor(
    public status: ContentfulStatusCode,
    public code: ErrorCode,
    message?: string
  ) {
    super(message ?? code);
  }
}
