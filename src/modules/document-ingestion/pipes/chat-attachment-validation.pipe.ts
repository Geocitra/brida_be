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
export class ChatAttachmentSignatureValidationPipe implements PipeTransform {
    private readonly logger = new Logger(ChatAttachmentSignatureValidationPipe.name);
    private readonly MAX_FILE_SIZE_BYTES = 20 * 1024 * 1024;

    // Magic Bytes Signatures untuk tipe file yang diizinkan
    private readonly PDF_MAGIC = [0x25, 0x50, 0x44, 0x46];
    private readonly DOCX_ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04];
    private readonly PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47];
    private readonly JPEG_MAGIC = [0xff, 0xd8, 0xff];

    transform(file: Express.Multer.File): Express.Multer.File {
        if (!file) {
            throw new BadRequestException('Berkas lampiran wajib disertakan.');
        }

        if (file.size > this.MAX_FILE_SIZE_BYTES) {
            const sizeMb = (file.size / (1024 * 1024)).toFixed(2);
            throw new PayloadTooLargeException(
                `Ukuran berkas (${sizeMb} MB) melampaui batas maksimum 20 MB.`,
            );
        }

        const buffer = file.buffer;
        if (!buffer || buffer.length === 0) {
            throw new BadRequestException('Buffer berkas kosong atau tidak valid.');
        }

        const detectedType = this.detectMagicNumberType(buffer);

        if (detectedType === 'UNKNOWN') {
            this.logger.warn(`Berkas '${file.originalname}' ditolak: Tanda biner tidak didukung.`);
            throw new UnsupportedMediaTypeException(
                `Format berkas '${file.originalname}' tidak didukung. Sistem hanya menerima PDF, DOCX, TXT, PNG, dan JPEG.`,
            );
        }

        // Normalisasi paksa tipe MIME berdasarkan deteksi Magic Number asli
        this.normalizeMimeType(file, detectedType);

        this.logger.log(
            `[Signature Pass] Berkas '${file.originalname}' divalidasi sebagai: ${detectedType}`,
        );

        return file;
    }

    private detectMagicNumberType(buffer: Buffer): 'PDF' | 'DOCX' | 'TXT' | 'PNG' | 'JPEG' | 'UNKNOWN' {
        if (this.checkMagicBytes(buffer, this.PDF_MAGIC)) return 'PDF';
        if (this.checkMagicBytes(buffer, this.DOCX_ZIP_MAGIC)) return 'DOCX';
        if (this.checkMagicBytes(buffer, this.PNG_MAGIC)) return 'PNG';
        if (this.checkMagicBytes(buffer, this.JPEG_MAGIC)) return 'JPEG';
        if (this.isPrintableTextBuffer(buffer)) return 'TXT';
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
        const sampleLength = Math.min(buffer.length, 512);
        for (let i = 0; i < sampleLength; i++) {
            const byte = buffer[i];
            if (byte !== 9 && byte !== 10 && byte !== 13 && byte < 32) {
                return false;
            }
        }
        return true;
    }

    private normalizeMimeType(file: Express.Multer.File, type: string): void {
        const mimeMap: Record<string, string> = {
            PDF: 'application/pdf',
            DOCX: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            PNG: 'image/png',
            JPEG: 'image/jpeg',
            TXT: 'text/plain',
        };
        if (mimeMap[type]) {
            file.mimetype = mimeMap[type];
        }
    }
}