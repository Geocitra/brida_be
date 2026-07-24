import { Injectable } from '@nestjs/common';
import { ITextFilter } from '../../interfaces/text-filter.interface';

@Injectable()
export class WhitespaceTrimmerFilter implements ITextFilter {
  readonly filterName = 'WhitespaceTrimmerFilter';

  filter(text: string): string {
    if (!text) return '';

    // 1. Convert non-standard spaces/tabs to standard space
    let cleanText = text.replace(/[ \t]+/g, ' ');

    // 2. Reduce 3+ consecutive newlines to double newline (paragraph boundary)
    cleanText = cleanText.replace(/\n{3,}/g, '\n\n');

    // 3. Trim leading and trailing whitespace per line
    cleanText = cleanText
      .split('\n')
      .map((line) => line.trim())
      .join('\n');

    return cleanText.trim();
  }
}
