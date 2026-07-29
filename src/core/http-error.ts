export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
  }
}

export const badRequest = (message: string, details?: unknown) => new HttpError(400, message, details);
export const unauthorized = (message = "Unauthorized") => new HttpError(401, message);
export const forbidden = (message = "Forbidden") => new HttpError(403, message);
export const notFound = (message = "Resource not found") => new HttpError(404, message);
export const conflict = (message = "Conflict", details?: unknown) => new HttpError(409, message, details);
export const serviceUnavailable = (message = "Service unavailable") => new HttpError(503, message);
