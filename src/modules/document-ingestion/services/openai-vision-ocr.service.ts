import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { join } from 'path';
import { existsSync, writeFileSync, unlinkSync, mkdirSync } from 'fs';
import * as puppeteer from 'puppeteer-core';

@Injectable()
export class OpenAiVisionOcrService {
  private readonly logger = new Logger(OpenAiVisionOcrService.name);

  constructor(private readonly configService: ConfigService) {}

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

  /**
   * Mengekstrak seluruh teks dan pasal dari dokumen scan PDF menggunakan model OpenAI gpt-4o
   */
  async extractTextFromPdfScan(buffer: Buffer, filename: string = 'document.pdf'): Promise<string> {
    const apiKey = this.configService.get<string>('OPENAI_API_KEY');

    if (!apiKey || apiKey.trim().length === 0) {
      this.logger.warn('[OpenAI OCR] OPENAI_API_KEY belum dikonfigurasi di file .env.');
      return '';
    }

    const modelName = this.configService.get<string>('OPENAI_MODEL') || 'gpt-4o';
    this.logger.log(`[OpenAI OCR] Memulai proses transkripsi visual dokumen scan menggunakan model '${modelName}'...`);

    // METODE 1: OpenAI Direct PDF Ingestion (Modalitas Berkas Langsung)
    try {
      const directResult = await this.callOpenAiDirectPdf(apiKey, modelName, buffer, filename);
      if (directResult && directResult.trim().length > 150) {
        this.logger.log(`[OpenAI OCR Direct Pass] Berhasil mentranskripsikan ${directResult.length} karakter via OpenAI Direct PDF.`);
        return directResult;
      }
    } catch (directErr: any) {
      this.logger.warn(`[OpenAI OCR Direct Failed] ${directErr.message}. Beralih ke Jalur Cadangan Visual (Puppeteer Headless)...`);
    }

    // METODE 2: Jalur Cadangan (Puppeteer Render Halaman ke Image URL)
    try {
      const visionResult = await this.callOpenAiViaPuppeteerScreenshot(apiKey, modelName, buffer);
      if (visionResult && visionResult.trim().length > 100) {
        this.logger.log(`[OpenAI OCR Vision Pass] Berhasil mentranskripsikan ${visionResult.length} karakter via Puppeteer Image Vision.`);
        return visionResult;
      }
    } catch (visionErr: any) {
      this.logger.error(`[OpenAI OCR Vision Failed] Jalur visual cadangan gagal: ${visionErr.message}`);
    }

    return '';
  }

  /**
   * Memanggil endpoint Chat Completions OpenAI dengan modalitas file PDF Base64 langsung
   */
  private async callOpenAiDirectPdf(
    apiKey: string,
    modelName: string,
    buffer: Buffer,
    filename: string,
  ): Promise<string> {
    const url = 'https://api.openai.com/v1/chat/completions';
    const base64Pdf = buffer.toString('base64');

    const promptText =
      'Anda adalah spesialis OCR dan ekstraksi dokumen hukum/pemerintahan daerah. ' +
      'Transkripsikan SELURUH isi dokumen scan/fotokopi ini secara lengkap, kata demi kata, pasal demi pasal, ayat demi ayat, dari awal hingga akhir. ' +
      'WAJIB menuliskan seluruh konsiderans (Menimbang, Mengingat), setiap Bab, setiap Pasal dan Ayat, serta bagian penutup tanpa ada yang dipotong, diringkas, atau dihilangkan. ' +
      'Pertahankan nomor peraturan, tanggal, dan format asli.';

    const requestBody = {
      model: modelName,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: promptText,
            },
            {
              type: 'file',
              file: {
                filename: filename,
                file_data: `data:application/pdf;base64,${base64Pdf}`,
              },
            },
          ],
        },
      ],
      temperature: 0.0,
      max_tokens: 16384,
    };

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(requestBody),
    });

    const data = await response.json();

    if (!response.ok) {
      const errMsg = data?.error?.message || response.statusText;
      throw new Error(`OpenAI Direct PDF Error (${response.status}): ${errMsg}`);
    }

    return data?.choices?.[0]?.message?.content || '';
  }

  /**
   * Jalur Cadangan: Merender PDF menjadi gambar via Chromium lokal lalu dikirim sebagai image_url
   */
  private async callOpenAiViaPuppeteerScreenshot(
    apiKey: string,
    modelName: string,
    buffer: Buffer,
  ): Promise<string> {
    const tempDir = join(process.cwd(), 'uploads', 'temp');
    if (!existsSync(tempDir)) {
      mkdirSync(tempDir, { recursive: true });
    }
    const tempFileName = `temp_ocr_${Date.now()}_${Math.random().toString(36).substring(2, 7)}.pdf`;
    const tempPath = join(tempDir, tempFileName);

    writeFileSync(tempPath, buffer);

    let browser: puppeteer.Browser | null = null;
    let screenshotBase64 = '';

    try {
      const executablePath = this.getExecutablePath();
      browser = await puppeteer.launch({
        executablePath,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      });

      const page = await browser.newPage();
      await page.setViewport({ width: 1200, height: 1600, deviceScaleFactor: 2 });
      await page.goto(`file://${tempPath}`, { waitUntil: 'networkidle0', timeout: 15000 });

      // Ambil tangkapan visual halaman dokumen scan
      const screenshotBuffer = await page.screenshot({ type: 'jpeg', quality: 90, fullPage: true });
      screenshotBase64 = Buffer.from(screenshotBuffer).toString('base64');
    } finally {
      if (browser) await browser.close();
      if (existsSync(tempPath)) {
        try {
          unlinkSync(tempPath);
        } catch {}
      }
    }

    if (!screenshotBase64) {
      throw new Error('Gagal merender gambar dokumen scan.');
    }

    // Kirim tangkapan layar dokumen scan ke endpoint Vision OpenAI (gpt-4o)
    const url = 'https://api.openai.com/v1/chat/completions';
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: modelName,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: 'Transkripsikan seluruh isi dokumen hukum scan ini secara utuh dan lengkap kata demi kata, pasal demi pasal, ayat demi ayat. Jangan meringkas!',
              },
              {
                type: 'image_url',
                image_url: {
                  url: `data:image/jpeg;base64,${screenshotBase64}`,
                  detail: 'high',
                },
              },
            ],
          },
        ],
        temperature: 0.0,
        max_tokens: 16384,
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data?.error?.message || 'OpenAI Vision API Error');
    }

    return data?.choices?.[0]?.message?.content || '';
  }
}
