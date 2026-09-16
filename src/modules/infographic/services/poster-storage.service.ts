import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { join } from 'path';
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'fs';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class PosterStorageService {
  private readonly logger = new Logger(PosterStorageService.name);
  private readonly targetDir = join(process.cwd(), 'uploads', 'media', 'posters');

  constructor() {
    this.ensureStorageDirectory();
  }

  private ensureStorageDirectory(): void {
    if (!existsSync(this.targetDir)) {
      mkdirSync(this.targetDir, { recursive: true });
      this.logger.log(`[Storage Init] Direktori poster lokal dibuat: ${this.targetDir}`);
    }
  }

  savePosterBuffer(buffer: Buffer, sessionId: string, versionNumber: number): string {
    try {
      this.ensureStorageDirectory();
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
}
