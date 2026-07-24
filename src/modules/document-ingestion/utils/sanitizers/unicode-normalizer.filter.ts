import { Injectable } from '@nestjs/common';
import { ITextFilter } from '../../interfaces/text-filter.interface';

@Injectable()
export class UnicodeNormalizerFilter implements ITextFilter {
  readonly filterName = 'UnicodeNormalizerFilter';

  filter(text: string): string {
    if (!text) return '';

    // 1. Unicode NFC Normalization
    let cleanText = text.normalize('NFC');

    // 2. Remove invisible zero-width spaces, BOM, and non-printable control chars
    cleanText = cleanText.replace(/[\u200B-\u200D\uFEFF]/g, '');

    // 3. Normalize curly quotes and smart dashes to ASCII equivalents
    cleanText = cleanText
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201C\u201D]/g, '"')
      .replace(/[\u2013\u2014]/g, '-');

    return cleanText;
  }
}
