import { Injectable, UnprocessableEntityException, Logger } from '@nestjs/common';
import { IDocumentParser, ParsedDocumentOutput } from '../interfaces/document-parser.interface';

@Injectable()
export class TxtParserAdapter implements IDocumentParser {
  private readonly logger = new Logger(TxtParserAdapter.name);

  supports(mimeType: string): boolean {
    return mimeType === 'text/plain' || mimeType.startsWith('text/');
  }

  async parse(buffer: Buffer): Promise<ParsedDocumentOutput> {
    try {
      const rawText = buffer.toString('utf-8').trim();

      if (!rawText || rawText.length === 0) {
        throw new UnprocessableEntityException('File teks mentah kosong.');
      }

      const estimatedPages = Math.max(1, Math.ceil(rawText.length / 3000));
      this.logger.log(`[TxtParserAdapter] Berhasil mengekstraksi file teks TXT (${rawText.length} karakter).`);

      return {
        rawText,
        pageCount: estimatedPages,
      };
    } catch (err: any) {
      if (err instanceof UnprocessableEntityException) {
        throw err;
      }
      this.logger.error(`Error pada TxtParserAdapter: ${err.message}`);
      throw new UnprocessableEntityException(`Gagal membaca file teks TXT: ${err.message}`);
    }
  }
}
