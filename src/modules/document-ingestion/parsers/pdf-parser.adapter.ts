import { Injectable, UnprocessableEntityException, Logger } from '@nestjs/common';
import pdfParse from 'pdf-parse';
import { IDocumentParser, ParsedDocumentOutput } from '../interfaces/document-parser.interface';
import { OpenAiVisionOcrService } from '../services/openai-vision-ocr.service';

@Injectable()
export class PdfParserAdapter implements IDocumentParser {
  private readonly logger = new Logger(PdfParserAdapter.name);

  constructor(private readonly openAiVisionOcr: OpenAiVisionOcrService) {}

  supports(mimeType: string): boolean {
    return mimeType === 'application/pdf';
  }

  async parse(buffer: Buffer): Promise<ParsedDocumentOutput> {
    let pageCount = 1;
    let rawText = '';

    // 1. Ekstraksi Cepat Lokal Menggunakan pdf-parse
    try {
      const data = await pdfParse(buffer);
      pageCount = data.numpages || 1;
      rawText = data.text ? data.text.trim() : '';
      this.logger.log(`[PdfParserAdapter] pdf-parse membaca ${pageCount} halaman (${rawText.length} karakter).`);
    } catch (parseErr: any) {
      this.logger.warn(`[PdfParserAdapter] pdf-parse gagal membaca teks: ${parseErr.message}`);
    }

    // 2. SENSOR DETEKSI DOKUMEN SCAN (Jika teks kosong atau < 150 karakter)
    const isScannedDocument = !rawText || rawText.length < 150;

    if (isScannedDocument) {
      this.logger.warn(
        `[SCAN PDF TERDETEKSI] Dokumen PDF berupa scan fotokopi/gambar (hanya ${rawText.length} karakter terbaca). Mengaktifkan OpenAI Vision OCR Engine...`,
      );

      const ocrText = await this.openAiVisionOcr.extractTextFromPdfScan(buffer, 'document_scan.pdf');

      if (ocrText && ocrText.trim().length > 100) {
        this.logger.log(
          `[OpenAI OCR Berhasil] Sukses mentranskripsikan ${ocrText.length} karakter dari berkas scan fisik via OpenAI!`,
        );
        return {
          rawText: ocrText.trim(),
          pageCount: pageCount || Math.max(1, Math.ceil(ocrText.length / 3000)),
        };
      }

      // Jika OpenAI Vision juga tidak dapat mengenali tulisan
      throw new UnprocessableEntityException(
        'Dokumen berupa scan gambar dan OpenAI Vision tidak berhasil mengekstraksi teks. Pastikan tulisan pada scan terbaca jelas.',
      );
    }

    return {
      rawText,
      pageCount,
    };
  }
}
