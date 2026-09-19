import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { join } from 'path';
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'fs';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class PosterStorageService {
  private readonly logger = new Logger(PosterStorageService.name);
  private readonly targetDir = join(process.cwd(), 'uploads', 'media', 'posters');
  private readonly brandingDir = join(process.cwd(), 'uploads', 'media', 'branding');

  constructor() {
    this.ensureStorageDirectories();
  }

  private ensureStorageDirectories(): void {
    if (!existsSync(this.targetDir)) {
      mkdirSync(this.targetDir, { recursive: true });
      this.logger.log(`[Storage Init] Direktori poster lokal dibuat: ${this.targetDir}`);
    }
    if (!existsSync(this.brandingDir)) {
      mkdirSync(this.brandingDir, { recursive: true });
      this.logger.log(`[Storage Init] Direktori branding lokal dibuat: ${this.brandingDir}`);
    }
  }

  savePosterBuffer(buffer: Buffer, sessionId: string, versionNumber: number): string {
    try {
      this.ensureStorageDirectories();
      const uniqueId = uuidv4().substring(0, 8);
      const filename = `poster_${sessionId}_v${versionNumber}_${uniqueId}.png`;
      const absolutePath = join(this.targetDir, filename);

      writeFileSync(absolutePath, buffer);
      this.logger.log(`[Asset Persisted] File poster tersimpan: ${absolutePath}`);

      return `/uploads/media/posters/${filename}`;
    } catch (err: any) {
      this.logger.error(`Gagal menyimpan file biner poster ke disk: ${err.message}`);
      throw new InternalServerErrorException('Gagal melakukan persistensi berkas poster lokal.');
    }
  }

  saveBrandingLogoBuffer(buffer: Buffer, posterId: string, extension: string = 'png'): string {
    try {
      this.ensureStorageDirectories();
      const cleanExt = extension.replace('.', '').toLowerCase();
      const uniqueId = uuidv4().substring(0, 8);
      const filename = `logo_${posterId}_${uniqueId}.${cleanExt}`;
      const absolutePath = join(this.brandingDir, filename);

      writeFileSync(absolutePath, buffer);
      this.logger.log(`[Logo Persisted] File logo tersimpan: ${absolutePath}`);

      return `/uploads/media/branding/${filename}`;
    } catch (err: any) {
      this.logger.error(`Gagal menyimpan file biner logo ke disk: ${err.message}`);
      throw new InternalServerErrorException('Gagal melakukan persistensi berkas logo lokal.');
    }
  }

  saveComposedPosterBuffer(buffer: Buffer, posterId: string): string {
    try {
      this.ensureStorageDirectories();
      const uniqueId = uuidv4().substring(0, 8);
      const filename = `composed_${posterId}_${uniqueId}.png`;
      const absolutePath = join(this.targetDir, filename);

      writeFileSync(absolutePath, buffer);
      this.logger.log(`[Composed Persisted] File poster ber-branding tersimpan: ${absolutePath}`);

      return `/uploads/media/posters/${filename}`;
    } catch (err: any) {
      this.logger.error(`Gagal menyimpan file biner composed poster ke disk: ${err.message}`);
      throw new InternalServerErrorException('Gagal melakukan persistensi berkas poster komposit.');
    }
  }

  removePosterFile(relativeUrl: string): void {
    try {
      const filename = relativeUrl.replace('/uploads/media/posters/', '');
      const absolutePath = join(this.targetDir, filename);
      if (existsSync(absolutePath)) {
        unlinkSync(absolutePath);
        this.logger.log(`[Asset Purged] File poster dibersihkan: ${absolutePath}`);
      }
    } catch (err: any) {
      this.logger.warn(`Gagal menghapus file poster ${relativeUrl}: ${err.message}`);
    }
  }

  removeBrandingLogoFile(relativeUrl: string): void {
    try {
      const filename = relativeUrl.replace('/uploads/media/branding/', '');
      const absolutePath = join(this.brandingDir, filename);
      if (existsSync(absolutePath)) {
        unlinkSync(absolutePath);
        this.logger.log(`[Logo Purged] File logo dibersihkan: ${absolutePath}`);
      }
    } catch (err: any) {
      this.logger.warn(`Gagal menghapus file logo ${relativeUrl}: ${err.message}`);
    }
  }
}
