/**
 * Generic API envelopes used across the Oxy Pay HTTP surface.
 */

export interface ApiSuccess<T> {
  success: true;
  data: T;
}

export interface ApiError {
  success: false;
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiError;

export interface Paginated<T> {
  items: T[];
  /** Cursor for the next page. Absent when no more pages. */
  nextCursor?: string;
  /** Total count when cheap to compute. */
  total?: number;
}
