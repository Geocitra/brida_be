import { Injectable } from '@nestjs/common';
import { ITextFilter } from '../../interfaces/text-filter.interface';

@Injectable()
export class HeaderFooterRemoverFilter implements ITextFilter {
  readonly filterName = 'HeaderFooterRemoverFilter';

  // Pattern detector for page numbers (e.g. "Halaman 1 dari 10", "Page 5 of 12", "- 4 -")
  private readonly pageNumRegex =
    /^(?:halaman|page)\s*\d+\s*(?:dari|of)\s*\d+|^-\s*\d+\s*-$/gi;

  filter(text: string): string {
    if (!text) return '';

    const lines = text.split('\n');
    const filteredLines = lines.filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) return true; // keep blank line separators

      // Filter out page numbers
      if (this.pageNumRegex.test(trimmed)) {
        return false;
      }

      return true;
    });

    return filteredLines.join('\n');
  }
}
