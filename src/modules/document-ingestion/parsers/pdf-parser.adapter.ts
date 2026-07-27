import { Injectable, UnprocessableEntityException, Logger } from '@nestjs/common';
import pdfParse from 'pdf-parse';
import { IDocumentParser, ParsedDocumentOutput } from '../interfaces/document-parser.interface';

@Injectable()
export class PdfParserAdapter implements IDocumentParser {
  private readonly logger = new Logger(PdfParserAdapter.name);

  supports(mimeType: string): boolean {
    return mimeType === 'application/pdf';
  }

  async parse(buffer: Buffer): Promise<ParsedDocumentOutput> {
    try {
      const data = await pdfParse(buffer);
      const rawText = data.text ? data.text.trim() : '';

      if (!rawText || rawText.length === 0) {
        throw new UnprocessableEntityException(
          'Tidak ada teks yang dapat diekstraksi dari PDF. Dokumen mungkin berupa scan gambar murni tanpa lapisan OCR.',
        );
      }

      this.logger.log(`[PdfParserAdapter] Berhasil mengekstraksi ${data.numpages} halaman PDF (${rawText.length} karakter).`);

      return {
        rawText,
        pageCount: data.numpages || 1,
      };
    } catch (err: any) {
      if (err instanceof UnprocessableEntityException) {
        throw err;
      }
      if (err.message && err.message.toLowerCase().includes('password')) {
        throw new UnprocessableEntityException('PDF terproteksi kata sandi.');
      }
      this.logger.error(`Error pada PdfParserAdapter: ${err.message}`);
      throw new UnprocessableEntityException(`Gagal membaca struktur PDF: ${err.message}`);
    }
  }
}
