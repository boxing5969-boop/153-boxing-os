export interface ApiError {
  code: string;
  message: string;
}

export type ApiResponse<T> =
  | { success: true; data: T; message?: string }
  | { success: false; error: ApiError; data?: null };
