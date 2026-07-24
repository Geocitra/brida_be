import { Injectable, Logger } from '@nestjs/common';
import { ITextFilter } from '../../interfaces/text-filter.interface';
import { UnicodeNormalizerFilter } from './unicode-normalizer.filter';
import { WhitespaceTrimmerFilter } from './whitespace-trimmer.filter';
import { HeaderFooterRemoverFilter } from './header-footer-remover.filter';

@Injectable()
export class TextSanitizerPipeline {
  private readonly logger = new Logger(TextSanitizerPipeline.name);
  private readonly filters: ITextFilter[];

  constructor(
    unicodeFilter: UnicodeNormalizerFilter,
    headerFooterFilter: HeaderFooterRemoverFilter,
    whitespaceFilter: WhitespaceTrimmerFilter,
  ) {
    // Executed sequentially in pipeline order
    this.filters = [unicodeFilter, headerFooterFilter, whitespaceFilter];
  }

  sanitize(rawText: string): string {
    if (!rawText) return '';

    const initialLength = rawText.length;
    let sanitizedText = rawText;

    for (const filter of this.filters) {
      sanitizedText = filter.filter(sanitizedText);
    }

    const finalLength = sanitizedText.length;
    this.logger.log(
      `[TextSanitizerPipeline] Teks berhasil di-sanitasi. Panjang awal: ${initialLength} -> Panjang akhir: ${finalLength} karakter.`,
    );

    return sanitizedText;
  }
}
