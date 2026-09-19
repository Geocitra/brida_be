import {
  Injectable,
  Logger,
  NotFoundException,
  InternalServerErrorException,
} from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { PosterStorageService } from './poster-storage.service';
import { UpsertPosterBrandingDto } from '../dtos/poster-branding.dto';

@Injectable()
export class InfographicBrandingService {
  private readonly logger = new Logger(InfographicBrandingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly posterStorage: PosterStorageService,
  ) {}

  /**
   * Mengambil data branding aktif untuk satu poster
   */
  async getBranding(posterId: string) {
    const poster = await this.prisma.infographicPoster.findUnique({
      where: { id: posterId },
      include: { branding: true },
    });

    if (!poster) {
      throw new NotFoundException(`Poster dengan ID '${posterId}' tidak ditemukan.`);
    }

    return (
      poster.branding || {
        posterId,
        headerEnabled: false,
        logoUrl: null,
        institution: 'PEMERINTAH KABUPATEN MIMIKA',
        subInstitution: 'Badan Riset dan Inovasi Daerah',
        footerEnabled: false,
        footerText: 'Sumber: Dokumen Resmi BRIDA Kabupaten Mimika',
        layoutConfig: {
          headerBgColor: '#FFFFFF',
          headerTextColor: '#0F1E36',
          headerAlignment: 'left_with_logo',
          footerBgColor: '#0F1E36',
          footerTextColor: '#F8FAFC',
          footerAlignment: 'center',
        },
        composedUrl: null,
        brandingHash: null,
      }
    );
  }

  /**
   * Menyimpan / memperbarui konfigurasi branding poster.
   * Setiap ada pembaruan, cache composedUrl dan brandingHash di-reset agar
   * pengunduhan berikutnya merender ulang secara otomatis.
   */
  async upsertBranding(posterId: string, dto: UpsertPosterBrandingDto) {
    const poster = await this.prisma.infographicPoster.findUnique({
      where: { id: posterId },
      include: { branding: true },
    });

    if (!poster) {
      throw new NotFoundException(`Poster dengan ID '${posterId}' tidak ditemukan.`);
    }

    const currentBranding = poster.branding;
    const currentConfig = (currentBranding?.layoutConfig as Record<string, any>) || {};
    const newConfig = {
      ...currentConfig,
      ...(dto.layoutConfig || {}),
    };

    // Hapus composed file fisik lama jika ada karena data berubah
    if (currentBranding?.composedUrl) {
      this.posterStorage.removePosterFile(currentBranding.composedUrl);
    }

    const updated = await this.prisma.infographicPosterBranding.upsert({
      where: { posterId },
      create: {
        posterId,
        headerEnabled: dto.headerEnabled ?? false,
        institution: dto.institution ?? 'PEMERINTAH KABUPATEN MIMIKA',
        subInstitution: dto.subInstitution ?? 'Badan Riset dan Inovasi Daerah',
        footerEnabled: dto.footerEnabled ?? false,
        footerText: dto.footerText ?? 'Sumber: Dokumen Resmi BRIDA Kabupaten Mimika',
        layoutConfig: newConfig,
        composedUrl: null,
        brandingHash: null,
      },
      update: {
        ...(dto.headerEnabled !== undefined ? { headerEnabled: dto.headerEnabled } : {}),
        ...(dto.institution !== undefined ? { institution: dto.institution } : {}),
        ...(dto.subInstitution !== undefined ? { subInstitution: dto.subInstitution } : {}),
        ...(dto.footerEnabled !== undefined ? { footerEnabled: dto.footerEnabled } : {}),
        ...(dto.footerText !== undefined ? { footerText: dto.footerText } : {}),
        layoutConfig: newConfig,
        composedUrl: null,
        brandingHash: null,
      },
    });

    this.logger.log(`[Branding Updated] Konfigurasi branding untuk poster '${posterId}' berhasil diperbarui.`);
    return updated;
  }

  /**
   * Mengunggah berkas logo instansi (PNG / JPEG) untuk poster tertentu
   */
  async uploadLogo(posterId: string, file: Express.Multer.File) {
    const poster = await this.prisma.infographicPoster.findUnique({
      where: { id: posterId },
      include: { branding: true },
    });

    if (!poster) {
      throw new NotFoundException(`Poster dengan ID '${posterId}' tidak ditemukan.`);
    }

    const ext = file.mimetype === 'image/jpeg' ? 'jpg' : 'png';
    const newLogoUrl = this.posterStorage.saveBrandingLogoBuffer(file.buffer, posterId, ext);

    // Bersihkan file logo lama jika ada
    if (poster.branding?.logoUrl) {
      this.posterStorage.removeBrandingLogoFile(poster.branding.logoUrl);
    }
    // Bersihkan composed lama
    if (poster.branding?.composedUrl) {
      this.posterStorage.removePosterFile(poster.branding.composedUrl);
    }

    const updated = await this.prisma.infographicPosterBranding.upsert({
      where: { posterId },
      create: {
        posterId,
        headerEnabled: true,
        logoUrl: newLogoUrl,
        institution: 'PEMERINTAH KABUPATEN MIMIKA',
        subInstitution: 'Badan Riset dan Inovasi Daerah',
        composedUrl: null,
        brandingHash: null,
      },
      update: {
        headerEnabled: true,
        logoUrl: newLogoUrl,
        composedUrl: null,
        brandingHash: null,
      },
    });

    this.logger.log(`[Logo Uploaded] Logo poster '${posterId}' berhasil disimpan: ${newLogoUrl}`);
    return updated;
  }

  /**
   * Menghapus berkas logo instansi
   */
  async deleteLogo(posterId: string) {
    const poster = await this.prisma.infographicPoster.findUnique({
      where: { id: posterId },
      include: { branding: true },
    });

    if (!poster) {
      throw new NotFoundException(`Poster dengan ID '${posterId}' tidak ditemukan.`);
    }

    if (poster.branding?.logoUrl) {
      this.posterStorage.removeBrandingLogoFile(poster.branding.logoUrl);
    }
    if (poster.branding?.composedUrl) {
      this.posterStorage.removePosterFile(poster.branding.composedUrl);
    }

    const updated = await this.prisma.infographicPosterBranding.update({
      where: { posterId },
      data: {
        logoUrl: null,
        composedUrl: null,
        brandingHash: null,
      },
    });

    return updated;
  }
}
