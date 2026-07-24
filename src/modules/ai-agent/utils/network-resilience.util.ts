import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class NetworkResilienceUtil {
  private readonly logger = new Logger(NetworkResilienceUtil.name);

  /**
   * Executes an async task with Exponential Backoff retries.
   * - Detects Gemini 429/503 (High Demand / Rate Limit) and applies longer delay.
   * - Does NOT retry on validation/unprocessable errors (4xx non-429) — those are logic bugs, not transient.
   * @param task Async operation to execute
   * @param maxRetries Maximum retry attempts (default: 3)
   * @param initialDelayMs Initial delay in milliseconds (default: 2000ms)
   */
  async executeWithRetry<T>(
    task: () => Promise<T>,
    maxRetries: number = 3,
    initialDelayMs: number = 2000,
  ): Promise<T> {
    let attempt = 0;
    let delay = initialDelayMs;

    while (attempt < maxRetries) {
      try {
        attempt++;
        return await task();
      } catch (error: any) {
        const isTransientError = this.isTransientNetworkError(error);

        // Do NOT retry on logic/validation errors (e.g., 422 UnprocessableEntity)
        // These are deterministic failures — retrying won't help and wastes quota.
        if (!isTransientError) {
          this.logger.warn(
            `[NetworkResilience] Percobaan ${attempt}/${maxRetries} gagal dengan error non-transien: ${error.message}. Tidak melakukan retry — meneruskan fallback.`,
          );
          throw error;
        }

        this.logger.warn(
          `[NetworkResilience] Percobaan ${attempt}/${maxRetries} gagal (transien): ${error.message}. ${
            attempt < maxRetries ? `Mencoba ulang dalam ${delay}ms...` : 'Batas maksimal retry tercapai.'
          }`,
        );

        if (attempt >= maxRetries) {
          throw error;
        }

        await new Promise((resolve) => setTimeout(resolve, delay));

        // Exponential backoff: 2s → 4s → 8s
        // For rate-limit / high-demand errors, use a longer base delay
        delay = isTransientError && this.isRateLimitError(error)
          ? delay * 3  // 2s → 6s → 18s for 429/503
          : delay * 2; // 2s → 4s → 8s for generic network errors
      }
    }

    throw new Error('Penanganan retry gagal.');
  }

  /**
   * Returns true for transient network/server errors that benefit from retry.
   * Returns false for deterministic client-side failures (422, 400, etc.).
   */
  private isTransientNetworkError(error: any): boolean {
    const msg = error?.message?.toLowerCase() || '';
    const status = error?.status || error?.statusCode;

    // Gemini-specific transient error signals
    if (msg.includes('high demand') || msg.includes('503') || msg.includes('rate limit') || msg.includes('429')) {
      return true;
    }

    // Generic network/fetch failures
    if (msg.includes('fetch failed') || msg.includes('network') || msg.includes('timeout') || msg.includes('econnrefused')) {
      return true;
    }

    // HTTP 5xx server errors from Gemini API
    if (status >= 500 && status < 600) return true;

    // 429 Too Many Requests
    if (status === 429) return true;

    return false;
  }

  private isRateLimitError(error: any): boolean {
    const msg = error?.message?.toLowerCase() || '';
    return msg.includes('rate limit') || msg.includes('429') || msg.includes('high demand') || msg.includes('503');
  }
}
