import { Injectable, BadRequestException, Logger } from '@nestjs/common';

@Injectable()
export class PromptInjectionSanitizer {
  private readonly logger = new Logger(PromptInjectionSanitizer.name);

  // Blacklisted prompt injection / jailbreak regex patterns
  private readonly injectionPatterns: RegExp[] = [
    /ignore\s+(?:all\s+)?previous\s+instructions/i,
    /disregard\s+(?:all\s+)?system\s+prompts?/i,
    /forget\s+(?:all\s+)?rules/i,
    /override\s+(?:system\s+)?directives?/i,
    /you\s+are\s+now\s+(?:DAN|jailbroken|unfiltered)/i,
    /act\s+as\s+an\s+uncensored/i,
    /bypass\s+zero-knowledge/i,
    /abaikan\s+(?:semua\s+)?instruksi\s+sebelumnya/i,
    /lupakan\s+(?:semua\s+)?aturan/i,
  ];

  sanitize(userQuery: string): string {
    if (!userQuery || userQuery.trim().length === 0) {
      throw new BadRequestException('Query pengguna tidak boleh kosong.');
    }

    const cleanQuery = userQuery.trim();

    for (const pattern of this.injectionPatterns) {
      if (pattern.test(cleanQuery)) {
        this.logger.warn(`[Security Alert] Prompt Injection terdeteksi pada kueri: "${cleanQuery}"`);
        throw new BadRequestException(
          'Kueri ditolak oleh sistem keamanan BRIDA. Terdeteksi pola manipulasi perintah (Prompt Injection).',
        );
      }
    }

    return cleanQuery;
  }
}
