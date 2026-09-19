import {
  Injectable,
  Logger,
  OnModuleDestroy,
  InternalServerErrorException,
} from '@nestjs/common';
import * as puppeteer from 'puppeteer-core';
import { existsSync } from 'fs';
import { join } from 'path';
import {
  IPosterRenderer,
  RenderPosterOptions,
} from '../interfaces/poster-renderer.interface';
import { generatePosterBrandingHtml } from '../templates/poster-branding.template';

@Injectable()
export class HtmlPosterRenderer implements IPosterRenderer, OnModuleDestroy {
  private readonly logger = new Logger(HtmlPosterRenderer.name);
  private browser: puppeteer.Browser | null = null;

  async onModuleDestroy() {
    if (this.browser) {
      try {
        await this.browser.close();
      } catch (err: any) {
        this.logger.warn(`Error closing Puppeteer browser: ${err.message}`);
      }
      this.browser = null;
    }
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
    this.logger.log(`[HtmlPosterRenderer] Meluncurkan instance Chromium: ${executablePath}`);

    this.browser = await puppeteer.launch({
      executablePath,
      headless: true,
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
      this.logger.warn('[HtmlPosterRenderer] Koneksi Chromium terputus. Reset instance.');
      this.browser = null;
    });

    return this.browser;
  }

  async render(options: RenderPosterOptions): Promise<Buffer> {
    try {
      const browser = await this.getBrowser();
      const page = await browser.newPage();

      try {
        await page.setViewport({
          width: options.width,
          height: options.height,
          deviceScaleFactor: 1,
        });

        const html = generatePosterBrandingHtml(options);
        await page.setContent(html, { waitUntil: 'load' });

        const screenshotBuffer = await page.screenshot({
          type: 'png',
          clip: {
            x: 0,
            y: 0,
            width: options.width,
            height: options.height,
          },
        });

        return Buffer.from(screenshotBuffer);
      } finally {
        await page.close();
      }
    } catch (err: any) {
      this.logger.error(`[HtmlPosterRenderer] Gagal merender komposisi poster: ${err.message}`);
      throw new InternalServerErrorException(
        `Gagal merender poster komposit beresolusi tinggi: ${err.message}`,
      );
    }
  }
}
