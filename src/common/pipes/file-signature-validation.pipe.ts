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
export class FileSignatureValidationPipe implements PipeTransform {
  private readonly logger = new Logger(FileSignatureValidationPipe.name);

  // Maximum file size limit: 20 MB (20,971,520 bytes)
  private readonly MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;

  // Magic number byte signatures
  // PDF: %PDF- (0x25 0x50 0x44 0x46 0x2D)
  private readonly PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d];

  // DOCX (ZIP format): PK\x03\x04 (0x50 0x4B 0x03 0x04)
  private readonly DOCX_ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];

  transform(file: Express.Multer.File): Express.Multer.File {
    if (!file) {
      throw new BadRequestException('Dokumen laporan wajib diunggah (multipart form-data file key: "file").');
    }

    // 1. Fail-Fast: Fail fast if file size exceeds 20MB
    if (file.size > this.MAX_FILE_SIZE_BYTES) {
      const sizeMb = (file.size / (1024 * 1024)).toFixed(2);
      this.logger.warn(`File '${file.originalname}' ditolak: Ukuran file (${sizeMb} MB) melebihi batas maksimal 20 MB.`);
      throw new PayloadTooLargeException(
        `Ukuran file (${sizeMb} MB) melebihi batas maksimum 20 MB yang diizinkan sistem BRIDA.`,
      );
    }

    const buffer = file.buffer;
    if (!buffer || buffer.length === 0) {
      throw new BadRequestException('File buffer kosong atau tidak valid.');
    }

    // 2. Deep Magic Number Validation
    const detectedType = this.detectMagicNumberType(buffer);

    if (detectedType === 'UNKNOWN') {
      this.logger.warn(
        `File '${file.originalname}' (MIME dikirim: '${file.mimetype}') ditolak: Magic number byte signature tidak valid.`,
      );
      throw new UnsupportedMediaTypeException(
        `Format file '${file.originalname}' ditolak. Magic Number byte signature tidak cocok dengan dokumen PDF, DOCX, atau TXT yang diizinkan.`,
      );
    }

    // Assign true validated MIME type to file object
    if (detectedType === 'PDF') {
      file.mimetype = 'application/pdf';
    } else if (detectedType === 'DOCX') {
      file.mimetype = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    } else if (detectedType === 'TXT') {
      file.mimetype = 'text/plain';
    }

    this.logger.log(
      `[Magic Number Pass] File '${file.originalname}' berhasil divalidasi sebagai tipe: ${detectedType} (${file.size} bytes).`,
    );

    return file;
  }

  private detectMagicNumberType(buffer: Buffer): 'PDF' | 'DOCX' | 'TXT' | 'UNKNOWN' {
    // Check PDF Magic Number (%PDF-)
    if (this.checkMagicBytes(buffer, this.PDF_MAGIC)) {
      return 'PDF';
    }

    // Check DOCX / ZIP Magic Number (PK\x03\x04)
    if (this.checkMagicBytes(buffer, this.DOCX_ZIP_MAGIC)) {
      return 'DOCX';
    }

    // Check Plain Text (TXT) - Verify UTF-8 printable text without raw control binaries
    if (this.isPrintableTextBuffer(buffer)) {
      return 'TXT';
    }

    return 'UNKNOWN';
  }

  private checkMagicBytes(buffer: Buffer, magic: number[]): boolean {
    if (buffer.length < magic.length) return false;
    for (let i = 0; i < magic.length; i++) {
      if (buffer[i] !== magic[i]) return false;
    }
    return true;
  }

  private isPrintableTextBuffer(buffer: Buffer): boolean {
    // Sample first 512 bytes for binary non-printable control characters
    const sampleLength = Math.min(buffer.length, 512);
    for (let i = 0; i < sampleLength; i++) {
      const byte = buffer[i];
      // Allow tab (9), newline (10), carriage return (13), and printable ASCII/UTF8 (>= 32)
      if (byte !== 9 && byte !== 10 && byte !== 13 && byte < 32) {
        return false;
      }
    }
    return true;
  }
}
