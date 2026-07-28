import { Injectable, BadRequestException, UnprocessableEntityException, Logger } from '@nestjs/common';
import * as pdfParse from 'pdf-parse';
import * as mammoth from 'mammoth';

export interface ExtractedDocumentContent {
  rawText: string;
  pageCount: number;
}

@Injectable()
export class TextExtractorService {
  private readonly logger = new Logger(TextExtractorService.name);

  async extractText(fileBuffer: Buffer, mimeType: string): Promise<ExtractedDocumentContent> {
    if (!fileBuffer || fileBuffer.length === 0) {
      throw new BadRequestException('File buffer kosong atau tidak valid.');
    }

    try {
      if (mimeType === 'application/pdf') {
        return await this.extractPdf(fileBuffer);
      } else if (
        mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        mimeType === 'application/msword'
      ) {
        return await this.extractDocx(fileBuffer);
      } else if (mimeType.startsWith('text/')) {
        return this.extractTxt(fileBuffer);
      } else {
        throw new BadRequestException(`Tipe mime file '${mimeType}' tidak didukung.`);
      }
    } catch (error: any) {
      this.logger.error(`Error saat mengekstraksi teks dokumen: ${error.message}`);
      if (error instanceof BadRequestException || error instanceof UnprocessableEntityException) {
        throw error;
      }
      throw new UnprocessableEntityException(
        `Gagal mengekstraksi teks dari dokumen: ${error.message || 'File mungkin korup atau terproteksi kata sandi.'}`,
      );
    }
  }

  private async extractPdf(buffer: Buffer): Promise<ExtractedDocumentContent> {
    try {
      const parse = (pdfParse as any).default || pdfParse;
      const data = await parse(buffer);
      const text = data.text ? data.text.trim() : '';

      if (!text || text.length === 0) {
        throw new UnprocessableEntityException(
          'Tidak ada teks yang dapat diekstraksi dari PDF. Pastikan dokumen bukan scan gambar tanpa OCR.',
        );
      }

      return {
        rawText: text,
        pageCount: data.numpages || 1,
      };
    } catch (err: any) {
      if (err.message && err.message.toLowerCase().includes('password')) {
        throw new UnprocessableEntityException('PDF terproteksi oleh kata sandi.');
      }
      throw err;
    }
  }

  private async extractDocx(buffer: Buffer): Promise<ExtractedDocumentContent> {
    const result = await mammoth.extractRawText({ buffer });
    const text = result.value ? result.value.trim() : '';

    if (!text || text.length === 0) {
      throw new UnprocessableEntityException('Tidak ada teks yang dapat diekstraksi dari dokumen Word (DOCX).');
    }

    // Estimasi jumlah halaman untuk DOCX berdasarkan jumlah karakter (misal ~3000 karakter per halaman)
    const estimatedPages = Math.max(1, Math.ceil(text.length / 3000));

    return {
      rawText: text,
      pageCount: estimatedPages,
    };
  }

  private extractTxt(buffer: Buffer): ExtractedDocumentContent {
    const text = buffer.toString('utf-8').trim();
    if (!text || text.length === 0) {
      throw new UnprocessableEntityException('File teks kosong.');
    }

    const estimatedPages = Math.max(1, Math.ceil(text.length / 3000));
    return {
      rawText: text,
      pageCount: estimatedPages,
    };
  }
}
