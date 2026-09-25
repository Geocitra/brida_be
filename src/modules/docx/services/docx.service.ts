import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import HTMLtoDOCX from '@turbodocx/html-to-docx';
import { GenerateDocxDto } from '../dto/generate-docx.dto';
import * as fs from 'fs';
import { join, extname } from 'path';

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
   * Mengonversi seluruh elemen <img> (baik URL eksternal QuickChart maupun unggahan lokal)
   * menjadi Base64 Data URL sebelum diserahkan ke compiler HTMLtoDOCX.
   * Ini menjamin gambar 100% tertanam di Word tanpa resiko timeout, CORS, atau silent drop.
   */
  private async resolveAndEmbedImagesAsBase64(html: string): Promise<string> {
    if (!html || !html.includes('<img')) return html;

    const imgTagRegex = /<img\b([^>]*?)src=["']([^"']+)["']([^>]*?)>/gi;
    const matches = Array.from(html.matchAll(imgTagRegex));
    if (matches.length === 0) return html;

    let processedHtml = html;

    for (const match of matches) {
      const fullTag = match[0];
      const beforeSrc = match[1];
      let rawSrc = match[2];
      const afterSrc = match[3];

      // Jika sudah Base64 Data URL, tidak perlu diproses lagi
      if (rawSrc.startsWith('data:image/')) {
        continue;
      }

      try {
        let base64DataUrl = '';

        // KASUS 1: Path berkas lokal yang diunggah (/uploads/... atau uploads/...)
        if (rawSrc.startsWith('/uploads/') || rawSrc.startsWith('uploads/')) {
          const cleanPath = rawSrc.replace(/^\/+/, '');
          const localFilePath = join(process.cwd(), cleanPath);
          if (fs.existsSync(localFilePath)) {
            const fileBuf = await fs.promises.readFile(localFilePath);
            const ext = extname(localFilePath).toLowerCase().replace('.', '') || 'png';
            const mime = ext === 'jpg' ? 'jpeg' : ext;
            base64DataUrl = `data:image/${mime};base64,${fileBuf.toString('base64')}`;
            this.logger.log(`[DocxService] Berhasil menanamkan gambar lokal '${cleanPath}' sebagai Base64.`);
          } else {
            this.logger.warn(`[DocxService] Berkas gambar lokal '${localFilePath}' tidak ditemukan di disk.`);
          }
        }
        // KASUS 2: URL Jaringan Eksternal (QuickChart atau HTTP/HTTPS)
        else if (rawSrc.startsWith('http://') || rawSrc.startsWith('https://')) {
          // Decode entitas HTML &amp; menjadi & agar query parameter QuickChart tidak terkorupsi
          const cleanUrl = rawSrc.replace(/&amp;/g, '&');
          this.logger.log(`[DocxService] Mengunduh & menanamkan grafik/gambar dari URL eksternal: ${cleanUrl.substring(0, 80)}...`);

          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 12000); // 12 detik aman

          try {
            const response = await fetch(cleanUrl, {
              signal: controller.signal,
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) BRIDA-SmartAnalysis/1.0',
                'Accept': 'image/png,image/jpeg,image/*,*/*',
              },
            });

            if (response.ok) {
              const arrayBuffer = await response.arrayBuffer();
              const buffer = Buffer.from(arrayBuffer);
              if (buffer.length > 0) {
                const contentType = response.headers.get('content-type') || 'image/png';
                const safeMime = contentType.split(';')[0].trim() || 'image/png';
                base64DataUrl = `data:${safeMime};base64,${buffer.toString('base64')}`;
                this.logger.log(`[DocxService] Sukses mengonversi gambar ke Base64 (${buffer.length} bytes, MIME: ${safeMime}).`);
              }
            } else {
              this.logger.warn(`[DocxService] Gagal mengunduh gambar (Status ${response.status}): ${cleanUrl.substring(0, 100)}`);
            }
          } finally {
            clearTimeout(timeoutId);
          }
        }

        if (base64DataUrl) {
          // Gantikan atribut src dengan data URL tanpa merusak penutup tag (/> atau >)
          let replacementTag = fullTag.replace(/src=["'][^"']+["']/i, `src="${base64DataUrl}"`);
          if (!replacementTag.includes('width=') && !replacementTag.includes('style=')) {
            if (replacementTag.endsWith('/>')) {
              replacementTag = replacementTag.slice(0, -2) + ' width="650" />';
            } else if (replacementTag.endsWith('>')) {
              replacementTag = replacementTag.slice(0, -1) + ' width="650">';
            }
          }
          processedHtml = processedHtml.replace(fullTag, replacementTag);
        }
      } catch (err: any) {
        this.logger.warn(`[DocxService] Gagal memproses gambar untuk DOCX: ${err.message}`);
        // Fallback: biarkan tag asli jika terjadi kegagalan tak terduga
      }
    }

    // Pastikan tag <img> yang berdiri sendiri dibungkus <p> agar diolah sebagai blok paragraf Word
    processedHtml = processedHtml.replace(/(?<!<p[^>]*>)\s*(<img\b[^>]*>)\s*(?!<\/p>)/gi, '<p>$1</p>');

    return processedHtml;
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
      const readyHtml = await this.resolveAndEmbedImagesAsBase64(cleanHtml);

      // Konversi margin dari Centimeter ke Twips / DXA (1 cm ≈ 567 twips)
      const marginTwips = Math.round((dto.marginCm || 2.5) * 567);

      // Konversi font size dari Point (pt) ke Half-Points (HIP) untuk standar OpenXML Microsoft Word
      // 1 pt = 2 half-points. Jadi 11 pt harus dikirimkan sebagai 22 half-points agar berukuran 11pt di Word!
      const baseFontSizePt = dto.fontSize && dto.fontSize >= 8 && dto.fontSize <= 36 ? dto.fontSize : 11;
      const fontSizeHIP = Math.round(baseFontSizePt * 2);

      const bufferResult = await HTMLtoDOCX(readyHtml, null, {
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
