import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import HTMLtoDOCX from '@turbodocx/html-to-docx';
import { GenerateDocxDto } from '../dto/generate-docx.dto';

@Injectable()
export class DocxService {
  private readonly logger = new Logger(DocxService.name);

  /**
   * Membersihkan token sitasi teknis RAG (seperti [doc:123], [uuid:1])
   */
  private stripCitationTokens(html: string): string {
    if (!html) return '';
    return html
      .replace(/\[(?:[a-f0-9-]{8,}|doc(?:[-_a-z0-9]+)?):\d+\]/gi, '')
      .replace(/\[(?:[a-f0-9-]{8,}|doc(?:[-_a-z0-9]+)?):\d+\]\[(?:[a-f0-9-]{8,}|doc(?:[-_a-z0-9]+)?):\d+\]/gi, '');
  }

  /**
   * Sanitasi elemen pembantu UI (no-print, page spacer) sebelum dikompilasi ke DOCX
   */
  private sanitizeHtml(html: string): string {
    if (!html) return '';

    let clean = html;
    // Hapus elemen dengan class no-print
    clean = clean.replace(/<[^>]*class=["'][^"']*no-print[^"']*["'][^>]*>[\s\S]*?<\/[^>]+>/gi, '');
    // Hapus elemen auto page spacer
    clean = clean.replace(/<[^>]*data-auto-page-spacer[^>]*>[\s\S]*?<\/[^>]+>/gi, '');
    // Bersihkan token sitasi RAG
    clean = this.stripCitationTokens(clean);
    // Pastikan angka font-size tanpa satuan diberi sufiks pt agar terbaca benar oleh parser OpenXML
    clean = clean.replace(/font-size:\s*(\d+(?:\.\d+)?)(?!pt|px|em|rem|%)/gi, 'font-size: $1pt');

    return clean;
  }

  /**
   * Mengompilasi naskah HTML semantik dari TipTap menjadi berkas biner Word OpenXML (.docx)
   */
  async generateDocx(dto: GenerateDocxDto): Promise<Buffer> {
    try {
      this.logger.log(`Memulai kompilasi naskah ke DOCX (${dto.filename || 'Draf_Artikel_BRIDA'})...`);
      const startTime = Date.now();

      const cleanHtml = this.sanitizeHtml(dto.htmlContent);

      // Konversi margin dari Centimeter ke Twips / DXA (1 cm ≈ 567 twips)
      const marginTwips = Math.round((dto.marginCm || 2.5) * 567);

      // Konversi font size dari Point (pt) ke Half-Points (HIP) untuk standar OpenXML Microsoft Word
      // 1 pt = 2 half-points. Jadi 11 pt harus dikirimkan sebagai 22 half-points agar berukuran 11pt di Word!
      const baseFontSizePt = dto.fontSize && dto.fontSize >= 8 && dto.fontSize <= 36 ? dto.fontSize : 11;
      const fontSizeHIP = Math.round(baseFontSizePt * 2);

      const bufferResult = await HTMLtoDOCX(cleanHtml, null, {
        title: dto.filename || 'Draf Artikel BRIDA',
        font: dto.fontFamily || 'Calibri',
        fontSize: fontSizeHIP,
        complexScriptFontSize: fontSizeHIP,
        heading: {
          heading1: {
            font: dto.fontFamily || 'Calibri',
            fontSize: 36, // 36 half-points = 18 pt (Judul Bab)
            bold: true,
            spacing: { before: 240, after: 120 },
          },
          heading2: {
            font: dto.fontFamily || 'Calibri',
            fontSize: 28, // 28 half-points = 14 pt (Sub-bab)
            bold: true,
            spacing: { before: 180, after: 80 },
          },
          heading3: {
            font: dto.fontFamily || 'Calibri',
            fontSize: 24, // 24 half-points = 12 pt (Sub-sub-bab)
            bold: true,
            spacing: { before: 120, after: 60 },
          },
          heading4: {
            font: dto.fontFamily || 'Calibri',
            fontSize: 22, // 22 half-points = 11 pt
            bold: true,
            spacing: { before: 80, after: 40 },
          },
        },
        margins: {
          top: marginTwips,
          right: marginTwips,
          bottom: marginTwips,
          left: marginTwips,
        },
        pageSize: {
          width: 11906,
          height: 16838, // Ukuran Kertas A4 Standar
        },
        table: {
          row: { cantSplit: true },
          borderOptions: {
            size: 4,
            stroke: 'single',
            color: 'CBD5E1',
          },
          addSpacingAfter: true,
        },
        pageNumber: true,
        footer: true,
        imageProcessing: {
          maxRetries: 2,
          downloadTimeout: 5000,
        },
      });

      const durationMs = Date.now() - startTime;
      const buffer = Buffer.isBuffer(bufferResult)
        ? bufferResult
        : Buffer.from(bufferResult as any);

      this.logger.log(`Kompilasi DOCX selesai dalam ${durationMs}ms (Ukuran: ${buffer.length} bytes).`);
      return buffer;
    } catch (error) {
      this.logger.error('Gagal mengompilasi naskah HTML ke DOCX:', error);
      const errMsg = error instanceof Error ? error.message : String(error);
      throw new InternalServerErrorException(`Gagal membuat berkas Word DOCX: ${errMsg}`);
    }
  }
}
