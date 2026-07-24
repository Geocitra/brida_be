import { Injectable, UnprocessableEntityException, Logger } from '@nestjs/common';
import * as mammoth from 'mammoth';
import { IDocumentParser, ParsedDocumentOutput } from '../interfaces/document-parser.interface';

@Injectable()
export class DocxParserAdapter implements IDocumentParser {
  private readonly logger = new Logger(DocxParserAdapter.name);

  supports(mimeType: string): boolean {
    return (
      mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
      mimeType === 'application/msword'
    );
  }

  async parse(buffer: Buffer): Promise<ParsedDocumentOutput> {
    try {
      const result = await mammoth.extractRawText({ buffer });
      const rawText = result.value ? result.value.trim() : '';

      if (!rawText || rawText.length === 0) {
        throw new UnprocessableEntityException('Tidak ada teks yang dapat diekstraksi dari dokumen DOCX.');
      }

      // Estimasi jumlah halaman (~3000 karakter per halaman)
      const estimatedPages = Math.max(1, Math.ceil(rawText.length / 3000));
      this.logger.log(`[DocxParserAdapter] Berhasil mengekstraksi dokumen DOCX (${rawText.length} karakter, est. ${estimatedPages} hal).`);

      return {
        rawText,
        pageCount: estimatedPages,
      };
    } catch (err: any) {
      if (err instanceof UnprocessableEntityException) {
        throw err;
      }
      this.logger.error(`Error pada DocxParserAdapter: ${err.message}`);
      throw new UnprocessableEntityException(`Gagal membaca struktur dokumen DOCX: ${err.message}`);
    }
  }
}
