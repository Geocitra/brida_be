import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { join } from 'path';
import { existsSync, readFileSync } from 'fs';
import * as puppeteer from 'puppeteer-core';
import { GeneratePdfDto } from '../dto/generate-pdf.dto';

@Injectable()
export class PdfService {
  private readonly logger = new Logger(PdfService.name);

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
   * Core generator PDF menggunakan Puppeteer
   */
  async generatePdf(dto: GeneratePdfDto): Promise<Buffer> {
    const { htmlContent, fontFamily, fontSize, lineSpacing, marginCm } = dto;
    const selectedFonts = this.fontFileMap[fontFamily as keyof typeof this.fontFileMap] || this.fontFileMap['Calibri'];

    this.logger.log(`Memulai proses pencetakan PDF dengan font ${fontFamily}, size ${fontSize}pt, margin ${marginCm}cm`);

    let browser: puppeteer.Browser | null = null;

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

            body {
              font-family: '${fontFamily}', sans-serif;
              font-size: ${fontSize}pt;
              line-height: ${lineSpacing};
              margin: 0;
              padding: 0;
              background: white;
              color: #000000;
              word-wrap: break-word;
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
              line-height: ${lineSpacing};
            }

            div[data-type="page-break"] {
              page-break-after: always;
              break-after: page;
              height: 0;
              overflow: hidden;
            }
          </style>
        </head>
        <body>
          ${htmlContent}
        </body>
        </html>
      `;

      // 3. Launch Puppeteer
      const executablePath = this.getExecutablePath();
      this.logger.debug(`Meluncurkan Puppeteer menggunakan executable: ${executablePath}`);

      browser = await puppeteer.launch({
        executablePath,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu',
        ],
      });

      const page = await browser.newPage();
      await page.setContent(fullHtmlContent, { waitUntil: 'networkidle0' as any });

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
      if (browser) {
        await browser.close();
      }
    }
  }
}
