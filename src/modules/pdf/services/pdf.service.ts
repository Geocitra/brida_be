import {
  Injectable,
  InternalServerErrorException,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { join } from 'path';
import { existsSync, readFileSync } from 'fs';
import * as puppeteer from 'puppeteer-core';
import { GeneratePdfDto } from '../dto/generate-pdf.dto';

@Injectable()
export class PdfService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PdfService.name);
  private browser: puppeteer.Browser | null = null;

  private readonly fontFileMap = {
    Calibri: {
      normal: 'calibri.ttf',
      bold: 'calibrib.ttf',
      italic: 'calibrii.ttf',
      boldItalic: 'calibriz.ttf',
    },
    'Times New Roman': {
      normal: 'times.ttf',
      bold: 'timesbd.ttf',
      italic: 'timesi.ttf',
      boldItalic: 'timesbi.ttf',
    },
    Verdana: {
      normal: 'verdana.ttf',
      bold: 'verdanab.ttf',
      italic: 'verdanai.ttf',
      boldItalic: 'verdanaz.ttf',
    },
    Arial: {
      normal: 'arial.ttf',
      bold: 'arialbd.ttf',
      italic: 'ariali.ttf',
      boldItalic: 'arialbi.ttf',
    },
  };

  async onModuleInit() {
    this.logger.log('Menginisialisasi PdfService - Menyiapkan Singleton Browser Chromium...');
    try {
      await this.getBrowser();
      this.logger.log('Singleton Browser Chromium siap beroperasi.');
    } catch (err: any) {
      this.logger.warn(
        `Gagal meluncurkan browser saat bootstrap: ${err.message}. Browser akan diluncurkan saat dibutuhkan (Lazy-load).`,
      );
    }
  }

  async onModuleDestroy() {
    this.logger.log('Menghentikan Singleton Browser Chromium...');
    if (this.browser) {
      try {
        await this.browser.close();
      } catch (err) {
        this.logger.error('Error saat menutup browser:', err);
      }
      this.browser = null;
    }
  }

  private async getBrowser(): Promise<puppeteer.Browser> {
    if (this.browser && this.browser.connected) {
      return this.browser;
    }

    if (this.browser) {
      try {
        await this.browser.close();
      } catch {}
      this.browser = null;
    }

    const executablePath = this.getExecutablePath();
    this.logger.log(`Meluncurkan instance Chromium baru: ${executablePath}`);

    this.browser = await puppeteer.launch({
      executablePath,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-extensions',
      ],
    });

    this.browser.on('disconnected', () => {
      this.logger.warn('Koneksi Chromium terputus. Instance akan di-reset otomatis.');
      this.browser = null;
    });

    return this.browser;
  }

  private getExecutablePath(): string {
    let executablePath = '/usr/bin/chromium';

    if (process.platform === 'win32') {
      const winPaths = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files\\Google\\Chrome Beta\\Application\\chrome.exe',
        join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
      ];
      for (const p of winPaths) {
        if (existsSync(p)) {
          executablePath = p;
          break;
        }
      }
    }
    return executablePath;
  }

  private getFontBase64(filename: string): string {
    const isProd = process.env.NODE_ENV === 'production';
    const fontsDir = join(process.cwd(), isProd ? 'dist/assets/fonts' : 'src/assets/fonts');
    const filePath = join(fontsDir, filename);

    if (!existsSync(filePath)) {
      this.logger.error(`File font tidak ditemukan di path: ${filePath}`);
      throw new InternalServerErrorException(`Font file not found: ${filename}`);
    }

    return readFileSync(filePath).toString('base64');
  }

  private resolveLocalImagesToInline(html: string): string {
    if (!html) return '';

    return html.replace(
      /(<img\s+[^>]*?src=["'])(?:https?:\/\/[^\/]+)?\/uploads\/media\/([^"'\s>]+)(["'][^>]*?>)/gi,
      (match, prefix, filename, suffix) => {
        try {
          const filePath = join(process.cwd(), 'uploads', 'media', filename);
          if (existsSync(filePath)) {
            const ext = filename.split('.').pop()?.toLowerCase() || 'png';
            const mime =
              ext === 'jpg' || ext === 'jpeg'
                ? 'image/jpeg'
                : ext === 'webp'
                  ? 'image/webp'
                  : ext === 'svg'
                    ? 'image/svg+xml'
                    : 'image/png';
            const base64Data = readFileSync(filePath).toString('base64');
            return `${prefix}data:${mime};base64,${base64Data}${suffix}`;
          }
        } catch (err: any) {
          this.logger.warn(`[PdfService] Gagal membaca gambar lokal '${filename}': ${err.message}`);
        }
        return match;
      },
    );
  }

  async generatePdf(dto: GeneratePdfDto): Promise<Buffer> {
    const { htmlContent, fontFamily, fontSize, lineSpacing, marginCm } = dto;
    const selectedFonts =
      this.fontFileMap[fontFamily as keyof typeof this.fontFileMap] || this.fontFileMap['Calibri'];

    this.logger.log(
      `[Puppeteer A4 Engine] Memulai kompilasi PDF (Font: ${fontFamily} ${fontSize}pt, LineSpacing: ${lineSpacing}, Margin: ${marginCm}cm)...`,
    );

    let page: puppeteer.Page | null = null;

    try {
      const fontNormal = this.getFontBase64(selectedFonts.normal);
      const fontBold = this.getFontBase64(selectedFonts.bold);
      const fontItalic = this.getFontBase64(selectedFonts.italic);
      const fontBoldItalic = this.getFontBase64(selectedFonts.boldItalic);

      const resolvedHtmlContent = this.resolveLocalImagesToInline(htmlContent);

      const fullHtmlContent = `
        <!DOCTYPE html>
        <html lang="id">
        <head>
          <meta charset="utf-8">
          <style>
            @font-face {
              font-family: '${fontFamily}';
              src: url(data:font/truetype;charset=utf-8;base64,${fontNormal}) format('truetype');
              font-weight: normal;
              font-style: normal;
            }
            @font-face {
              font-family: '${fontFamily}';
              src: url(data:font/truetype;charset=utf-8;base64,${fontBold}) format('truetype');
              font-weight: bold;
              font-style: normal;
            }
            @font-face {
              font-family: '${fontFamily}';
              src: url(data:font/truetype;charset=utf-8;base64,${fontItalic}) format('truetype');
              font-weight: normal;
              font-style: italic;
            }
            @font-face {
              font-family: '${fontFamily}';
              src: url(data:font/truetype;charset=utf-8;base64,${fontBoldItalic}) format('truetype');
              font-weight: bold;
              font-style: italic;
            }

            /* ── PENGATURAN HALAMAN FISIK KERTAS A4 ── */
            @page {
              size: A4 portrait;
              margin-top: ${marginCm}cm;
              margin-bottom: ${marginCm}cm;
              margin-left: ${marginCm}cm;
              margin-right: ${marginCm}cm;
            }

            * {
              box-sizing: border-box;
            }

            body, p, ul, ol, li, table, td, th, blockquote {
              font-family: '${fontFamily}', sans-serif;
              font-size: ${fontSize}pt;
              line-height: ${lineSpacing};
            }

            body {
              margin: 0;
              padding: 0;
              background: white;
              color: #0f172a;
              word-wrap: break-word;
              white-space: pre-wrap;
              tab-size: 48px;
            }

            p {
              margin-top: 0;
              margin-bottom: 12px;
              text-align: justify;
              text-justify: inter-word;
            }

            /* ── PENCEGAHAN ORPHAN PADA HEADING ── */
            h1, h2, h3, h4 {
              color: #0f172a;
              font-weight: 700;
              page-break-after: avoid !important;
              break-after: avoid !important;
            }

            h1 { font-size: 1.4em; margin-top: 20px; margin-bottom: 10px; }
            h2 { font-size: 1.2em; margin-top: 16px; margin-bottom: 8px; }
            h3 { font-size: 1.05em; margin-top: 14px; margin-bottom: 6px; }

            ul, ol {
              margin-top: 0;
              margin-bottom: 12px;
              padding-left: 22px;
            }

            li {
              margin-bottom: 4px;
            }

            /* ── STANDAR TABEL ANTI-OVERFLOW (LEBAR AMAN ~606PX) ── */
            table {
              width: 100% !important;
              max-width: 100% !important;
              table-layout: fixed !important;
              border-collapse: collapse !important;
              margin-top: 12px;
              margin-bottom: 16px;
              page-break-inside: auto;
            }

            thead {
              display: table-header-group; /* Otomatis mengulang header jika tabel berlanjut ke hal berikutnya */
            }

            tr {
              page-break-inside: avoid !important;
              break-inside: avoid !important;
            }

            th, td {
              border: 1px solid #cbd5e1;
              padding: 6px 10px;
              text-align: left;
              vertical-align: top;
              word-break: break-word !important;
              overflow-wrap: break-word !important;
              font-size: 0.95em;
            }

            th {
              background-color: #f8fafc !important;
              font-weight: bold;
              color: #0f172a;
            }

            /* ── STANDAR BLOCKQUOTE CALLOUT KEBIJAKAN ── */
            blockquote {
              border-left: 3px solid #0d9488 !important;
              background-color: #f0fdfa !important;
              padding: 8px 14px !important;
              margin: 12px 0 16px 0 !important;
              color: #134e4a !important;
              font-style: normal !important;
              page-break-inside: avoid !important;
              break-inside: avoid !important;
            }

            blockquote p {
              margin-bottom: 0 !important;
            }

            /* ── PENGATURAN GAMBAR & TEKS WRAPPING ── */
            img {
              max-width: 100% !important;
              height: auto !important;
              object-fit: contain;
              page-break-inside: avoid !important;
              break-inside: avoid !important;
            }

            img[data-align="float-left"] {
              float: left !important;
              margin: 8px 18px 12px 0 !important;
              display: inline-block !important;
              clear: none !important;
            }

            img[data-align="float-right"] {
              float: right !important;
              margin: 8px 0 12px 18px !important;
              display: inline-block !important;
              clear: none !important;
            }

            img[data-align="left"] {
              display: block !important;
              margin: 14px auto 14px 0 !important;
              clear: both !important;
            }

            img[data-align="right"] {
              display: block !important;
              margin: 14px 0 14px auto !important;
              clear: both !important;
            }

            img[data-align="center"] {
              display: block !important;
              margin: 14px auto !important;
              clear: both !important;
            }

            figcaption {
              text-align: center;
              font-size: 9pt;
              font-style: italic;
              color: #64748b;
              margin-top: 4px;
              margin-bottom: 12px;
            }

            /* ── KONTROL PEMUTUS HALAMAN ── */
            div[data-type="page-break"] {
              page-break-after: always !important;
              break-after: page !important;
              height: 0 !important;
              margin: 0 !important;
              padding: 0 !important;
            }

            /* ── PEMBERSIHAN ELEMEN SISTEM ── */
            div[data-auto-page-spacer],
            .no-print,
            .citation-url-node {
              display: none !important;
              height: 0 !important;
              margin: 0 !important;
              padding: 0 !important;
            }
          </style>
        </head>
        <body>
          ${resolvedHtmlContent}
        </body>
        </html>
      `;

      const browser = await this.getBrowser();
      page = await browser.newPage();

      await page.setContent(fullHtmlContent, {
        waitUntil: 'domcontentloaded',
      });

      // Menunggu seluruh aset gambar dan font eksternal selesai termuat sebelum pencetakan
      await page.evaluate(async () => {
        if ((document as any).fonts?.ready) {
          await (document as any).fonts.ready;
        }

        const images = Array.from(document.querySelectorAll('img'));
        await Promise.all(
          images.map((img) => {
            if (img.complete) return Promise.resolve();
            return new Promise((resolve) => {
              img.onload = resolve;
              img.onerror = resolve;
            });
          }),
        );
      });

      const marginPoints = `${marginCm}cm`;
      const pdfBuffer = await page.pdf({
        format: 'A4',
        printBackground: true,
        margin: {
          top: marginPoints,
          bottom: marginPoints,
          left: marginPoints,
          right: marginPoints,
        },
        displayHeaderFooter: true,
        headerTemplate: '<span style="font-size: 0px"></span>',
        footerTemplate: `
          <div style="font-size: 8px; font-family: Arial, sans-serif; color: #94a3b8; width: 100%; text-align: right; padding-right: ${marginCm}cm; margin-bottom: 10px; box-sizing: border-box;">
            Halaman <span class="pageNumber"></span> dari <span class="totalPages"></span>
          </div>
        `,
      });

      this.logger.log(`[Puppeteer Success] Dokumen PDF berhasil dirakit (${pdfBuffer.length} bytes).`);
      return Buffer.from(pdfBuffer);
    } catch (error) {
      this.logger.error('Gagal merakit PDF via Puppeteer Engine:', error);
      const errMsg = error instanceof Error ? error.message : String(error);
      throw new InternalServerErrorException(`Failed to generate PDF: ${errMsg}`);
    } finally {
      if (page) {
        try {
          await page.close();
        } catch (err) {
          this.logger.error('Gagal menutup tab Puppeteer:', err);
        }
      }
    }
  }
}