import { Injectable, InternalServerErrorException, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { join } from 'path';
import { existsSync, readFileSync } from 'fs';
import * as puppeteer from 'puppeteer-core';
import { GeneratePdfDto } from '../dto/generate-pdf.dto';

@Injectable()
export class PdfService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PdfService.name);
  private browser: puppeteer.Browser | null = null;

  // Pemetaan font ke berkas TTF lokal di assets/fonts
  private readonly fontFileMap = {
    'Calibri': {
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
    'Verdana': {
      normal: 'verdana.ttf',
      bold: 'verdanab.ttf',
      italic: 'verdanai.ttf',
      boldItalic: 'verdanaz.ttf',
    },
    'Arial': {
      normal: 'arial.ttf',
      bold: 'arialbd.ttf',
      italic: 'ariali.ttf',
      boldItalic: 'arialbi.ttf',
    },
  };

  async onModuleInit() {
    this.logger.log('Menginisialisasi PdfService - Menyiapkan Singleton Browser...');
    try {
      await this.getBrowser();
      this.logger.log('Singleton Browser berhasil di-boot dan stand-by.');
    } catch (err: any) {
      this.logger.warn(`Gagal meluncurkan browser saat startup: ${err.message}. Browser akan diluncurkan sesuai kebutuhan (lazy-load).`);
    }
  }

  async onModuleDestroy() {
    this.logger.log('Menutup PdfService - Menghentikan Singleton Browser...');
    if (this.browser) {
      try {
        await this.browser.close();
      } catch (err) {
        this.logger.error('Error saat menutup browser:', err);
      }
      this.browser = null;
    }
  }

  /**
   * Mengembalikan instance browser yang sedang berjalan, atau meluncurkan yang baru jika belum ada/bermasalah.
   */
  private async getBrowser(): Promise<puppeteer.Browser> {
    if (this.browser && this.browser.connected) {
      return this.browser;
    }

    // Jika instance tidak aktif atau terputus, pastikan kita close dulu
    if (this.browser) {
      try {
        await this.browser.close();
      } catch { }
      this.browser = null;
    }

    const executablePath = this.getExecutablePath();
    this.logger.log(`Meluncurkan instance Chromium baru menggunakan: ${executablePath}`);

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
        '--single-process', // Hemat RAM di VPS
        '--disable-extensions',
      ],
    });

    // Auto-recovery jika browser crash/close tak terduga
    this.browser.on('disconnected', () => {
      this.logger.warn('Koneksi Chromium terputus. Instance akan di-reset.');
      this.browser = null;
    });

    return this.browser;
  }

  /**
   * Menemukan executable Chromium/Chrome secara dinamis berdasarkan OS
   */
  private getExecutablePath(): string {
    let executablePath = '/usr/bin/chromium'; // Default Linux / Docker

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

  /**
   * Membaca font lokal dan mengonversinya ke Base64 string
   */
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

  /**
   * Core generator PDF menggunakan Puppeteer dengan Singleton Browser
   */
  async generatePdf(dto: GeneratePdfDto): Promise<Buffer> {
    const { htmlContent, fontFamily, fontSize, lineSpacing, marginCm } = dto;
    const selectedFonts = this.fontFileMap[fontFamily as keyof typeof this.fontFileMap] || this.fontFileMap['Calibri'];

    this.logger.log(`Memulai proses pencetakan PDF dengan font ${fontFamily}, size ${fontSize}pt, margin ${marginCm}cm`);

    let page: puppeteer.Page | null = null;

    try {
      // 1. Load Base64 untuk 4 varian font terpilih
      const fontNormal = this.getFontBase64(selectedFonts.normal);
      const fontBold = this.getFontBase64(selectedFonts.bold);
      const fontItalic = this.getFontBase64(selectedFonts.italic);
      const fontBoldItalic = this.getFontBase64(selectedFonts.boldItalic);

      // 2. Susun HTML dengan stylesheet @font-face base64
      const fullHtmlContent = `
        <!DOCTYPE html>
        <html>
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

            * {
              box-sizing: border-box;
            }

            body, p, ul, ol, li, table, td, th {
              font-family: '${fontFamily}', sans-serif;
              font-size: ${fontSize}pt;
              line-height: ${lineSpacing};
            }

            body {
              margin: 0;
              padding: 0;
              background: white;
              color: #000000;
              word-wrap: break-word;
              white-space: pre-wrap;
              tab-size: 48px;
            }

            p {
              margin-top: 0;
              margin-bottom: 12px;
              text-align: justify;
            }

            ul, ol {
              margin-top: 0;
              margin-bottom: 12px;
              padding-left: 20px;
            }

            li {
              margin-bottom: 4px;
            }

            div[data-type="page-break"] {
              page-break-after: always;
              break-after: page;
              height: 0;
              overflow: hidden;
            }

            /* --- INJEKSI CSS TABEL --- */
            table {
              width: 100%;
              border-collapse: collapse;
              margin-top: 10px;
              margin-bottom: 16px;
            }
            th, td {
              border: 1px solid #cbd5e1;
              padding: 6px 10px;
              text-align: left;
              vertical-align: top;
            }
            th {
              background-color: #f8fafc;
              font-weight: bold;
            }
          </style>
        </head>
        <body>
          ${htmlContent}
        </body>
        </html>
      `;

      // 3. Dapatkan instance browser singleton dan buka halaman baru
      const browser = await this.getBrowser();
      page = await browser.newPage();

      // Gunakan domcontentloaded untuk efisiensi RAM/waktu proses di VPS
      await page.setContent(fullHtmlContent, { waitUntil: 'domcontentloaded' as any });

      // 4. Generate PDF buffer
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

      this.logger.log(`PDF berhasil dibuat, ukuran: ${pdfBuffer.length} bytes`);
      return Buffer.from(pdfBuffer);

    } catch (error) {
      this.logger.error('Error saat membuat PDF via Puppeteer:', error);
      const errMsg = error instanceof Error ? error.message : String(error);
      throw new InternalServerErrorException(`Failed to generate PDF: ${errMsg}`);
    } finally {
      if (page) {
        try {
          await page.close();
        } catch (err) {
          this.logger.error('Gagal menutup tab halaman:', err);
        }
      }
    }
  }
}