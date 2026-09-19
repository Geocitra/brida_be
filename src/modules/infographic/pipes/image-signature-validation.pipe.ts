import {
  PipeTransform,
  Injectable,
  BadRequestException,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
  Logger,
} from '@nestjs/common';
import 'multer';

@Injectable()
export class ImageSignatureValidationPipe implements PipeTransform {
  private readonly logger = new Logger(ImageSignatureValidationPipe.name);

  // Batas ukuran file logo: 2 MB (2,097,152 bytes)
  private readonly MAX_FILE_SIZE_BYTES = 2 * 1024 * 1024;

  // Magic number byte signatures
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  private readonly PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  // JPEG: FF D8 FF
  private readonly JPEG_MAGIC = [0xff, 0xd8, 0xff];

  transform(file: Express.Multer.File): Express.Multer.File {
    if (!file) {
      throw new BadRequestException('Berkas logo wajib diunggah (multipart form-data file key: "logo").');
    }

    // 1. Validasi Batas Ukuran Maksimal 2MB
    if (file.size > this.MAX_FILE_SIZE_BYTES) {
      const sizeMb = (file.size / (1024 * 1024)).toFixed(2);
      this.logger.warn(
        `File logo '${file.originalname}' ditolak: Ukuran (${sizeMb} MB) melebihi batas maksimal 2 MB.`,
      );
      throw new PayloadTooLargeException(
        `Ukuran berkas logo (${sizeMb} MB) melebihi batas maksimum 2 MB yang diizinkan.`,
      );
    }

    const buffer = file.buffer;
    if (!buffer || buffer.length === 0) {
      throw new BadRequestException('Buffer berkas logo kosong atau tidak valid.');
    }

    // 2. Validasi Magic Number Bytes (PNG / JPEG Saja, Tolak SVG/HTML)
    const detectedType = this.detectImageType(buffer);

    if (detectedType === 'UNKNOWN') {
      this.logger.warn(
        `File logo '${file.originalname}' (MIME dikirim: '${file.mimetype}') ditolak: Magic byte signature bukan PNG/JPEG.`,
      );
      throw new UnsupportedMediaTypeException(
        `Format berkas logo '${file.originalname}' ditolak. Hanya format PNG dan JPEG/JPG resmi yang diizinkan sistem demi keamanan dokumen. Format SVG tidak diizinkan.`,
      );
    }

    file.mimetype = detectedType === 'PNG' ? 'image/png' : 'image/jpeg';
    return file;
  }

  private detectImageType(buffer: Buffer): 'PNG' | 'JPEG' | 'UNKNOWN' {
    if (this.matchesMagic(buffer, this.PNG_MAGIC)) {
      return 'PNG';
    }

    if (this.matchesMagic(buffer, this.JPEG_MAGIC)) {
      return 'JPEG';
    }

    return 'UNKNOWN';
  }

  private matchesMagic(buffer: Buffer, magic: number[]): boolean {
    if (buffer.length < magic.length) {
      return false;
    }
    for (let i = 0; i < magic.length; i++) {
      if (buffer[i] !== magic[i]) {
        return false;
      }
    }
    return true;
  }
}
