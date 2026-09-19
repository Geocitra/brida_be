import {
  Injectable,
  Inject,
  Logger,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { PosterStorageService } from './poster-storage.service';
import {
  POSTER_RENDERER_TOKEN,
  IPosterRenderer,
} from '../interfaces/poster-renderer.interface';

@Injectable()
export class PosterCompositionService {
  private readonly logger = new Logger(PosterCompositionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly posterStorage: PosterStorageService,
    @Inject(POSTER_RENDERER_TOKEN)
    private readonly posterRenderer: IPosterRenderer,
  ) {}

  /**
   * Menghitung dimensi piksel authoritative berdasarkan aspek rasio poster
   */
  private getCanvasDimensions(aspectRatio: string): { width: number; height: number } {
    switch (aspectRatio) {
      case '9:16':
        return { width: 1080, height: 1920 };
      case '16:9':
        return { width: 1920, height: 1080 };
      case '3:4':
        return { width: 1200, height: 1600 };
      case '4:3':
        return { width: 1600, height: 1200 };
      case '1:1':
      default:
        return { width: 1200, height: 1200 };
    }
  }

  /**
   * Menghasilkan hash SHA-256 untuk mendeteksi perubahan konfigurasi branding
   */
  private calculateBrandingHash(
    imageUrl: string,
    branding: any,
  ): string {
    const payload = JSON.stringify({
      imageUrl,
      headerEnabled: branding?.headerEnabled ?? false,
      logoUrl: branding?.logoUrl ?? null,
      institution: branding?.institution ?? '',
      subInstitution: branding?.subInstitution ?? '',
      footerEnabled: branding?.footerEnabled ?? false,
      footerText: branding?.footerText ?? '',
      layoutConfig: branding?.layoutConfig ?? {},
    });

    return createHash('sha256').update(payload).digest('hex');
  }

  /**
   * Mengomposisikan base poster dengan header dan footer menjadi file PNG final
   */
  async composePoster(posterId: string): Promise<string> {
    const poster = await this.prisma.infographicPoster.findUnique({
      where: { id: posterId },
      include: { branding: true },
    });

    if (!poster) {
      throw new NotFoundException(`Poster dengan ID '${posterId}' tidak ditemukan.`);
    }

    const branding = poster.branding;
    // Jika tidak ada konfigurasi branding aktif sama sekali, kembalikan gambar asli
    if (!branding || (!branding.headerEnabled && !branding.footerEnabled)) {
      return poster.imageUrl;
    }

    const currentHash = this.calculateBrandingHash(poster.imageUrl, branding);

    // 1. Cek Validitas Cache (Cache Hit)
    if (branding.composedUrl && branding.brandingHash === currentHash) {
      const cleanRelPath = branding.composedUrl.startsWith('/')
        ? branding.composedUrl.substring(1)
        : branding.composedUrl;
      const physicalPath = resolve(process.cwd(), cleanRelPath);

      if (existsSync(physicalPath)) {
        this.logger.log(`[Composition Cache Hit] Memakai berkas yang sudah terkomposisi untuk poster '${posterId}'.`);
        return branding.composedUrl;
      }
    }

    // 2. Cache Miss: Jalankan Engine Komposisi Puppeteer
    this.logger.log(`[Composition Engine] Memulai render komposisi baru untuk poster '${posterId}'...`);

    // Baca berkas gambar dasar AI dari disk
    const baseRelPath = poster.imageUrl.startsWith('/')
      ? poster.imageUrl.substring(1)
      : poster.imageUrl;
    const baseFullPath = resolve(process.cwd(), baseRelPath);

    if (!existsSync(baseFullPath)) {
      throw new NotFoundException('Berkas fisik poster dasar tidak ditemukan di server.');
    }

    const baseBuffer = readFileSync(baseFullPath);
    const baseImageDataUri = `data:image/png;base64,${baseBuffer.toString('base64')}`;

    // Baca berkas logo jika ada
    let logoDataUri: string | undefined = undefined;
    if (branding.headerEnabled && branding.logoUrl) {
      const logoRelPath = branding.logoUrl.startsWith('/')
        ? branding.logoUrl.substring(1)
        : branding.logoUrl;
      const logoFullPath = resolve(process.cwd(), logoRelPath);

      if (existsSync(logoFullPath)) {
        const logoBuffer = readFileSync(logoFullPath);
        const mime = branding.logoUrl.toLowerCase().endsWith('.jpg') || branding.logoUrl.toLowerCase().endsWith('.jpeg')
          ? 'image/jpeg'
          : 'image/png';
        logoDataUri = `data:${mime};base64,${logoBuffer.toString('base64')}`;
      }
    }

    const dimensions = this.getCanvasDimensions(poster.aspectRatio);

    const renderedBuffer = await this.posterRenderer.render({
      baseImageDataUri,
      width: dimensions.width,
      height: dimensions.height,
      headerEnabled: branding.headerEnabled,
      logoDataUri,
      institution: branding.institution,
      subInstitution: branding.subInstitution,
      footerEnabled: branding.footerEnabled,
      footerText: branding.footerText,
      layoutConfig: (branding.layoutConfig as any) || {},
    });

    // Simpan berkas hasil komposit ke disk server
    const composedUrl = this.posterStorage.saveComposedPosterBuffer(renderedBuffer, posterId);

    // Update database dengan path dan hash baru
    await this.prisma.infographicPosterBranding.update({
      where: { posterId },
      data: {
        composedUrl,
        brandingHash: currentHash,
      },
    });

    this.logger.log(`[Composition Success] Komposisi selesai: ${composedUrl}`);
    return composedUrl;
  }
}
