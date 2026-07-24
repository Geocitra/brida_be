import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class NetworkResilienceUtil {
  private readonly logger = new Logger(NetworkResilienceUtil.name);

  /**
   * Executes an async task with Exponential Backoff retries
   * @param task Async operation to execute
   * @param maxRetries Maximum retry attempts (default: 3)
   * @param initialDelayMs Initial delay in milliseconds (default: 1000ms)
   */
  async executeWithRetry<T>(
    task: () => Promise<T>,
    maxRetries: number = 3,
    initialDelayMs: number = 1000,
  ): Promise<T> {
    let attempt = 0;
    let delay = initialDelayMs;

    while (attempt < maxRetries) {
      try {
        attempt++;
        return await task();
      } catch (error: any) {
        this.logger.warn(
          `[NetworkResilience] Percobaan ${attempt}/${maxRetries} gagal: ${error.message}. ${
            attempt < maxRetries ? `Mencoba ulang dalam ${delay}ms...` : 'Batas maksimal retry tercapai.'
          }`,
        );

        if (attempt >= maxRetries) {
          throw error;
        }

        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 2; // Exponential backoff (1s, 2s, 4s...)
      }
    }

    throw new Error('Penanganan retry gagal.');
  }
}
