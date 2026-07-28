import {
  Controller,
  Post,
  Get,
  Delete,
  Param,
  Res,
  StreamableFile,
  UseInterceptors,
  UploadedFile,
  Body,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import { createReadStream } from 'fs';
import { FileInterceptor } from '@nestjs/platform-express';
import { DocumentIngestionService } from '../services/document-ingestion.service';
import { UploadDocumentDto } from '../dtos/upload-document.dto';
import { DocumentResponseDto } from '../dtos/document-response.dto';
import { FileSignatureValidationPipe } from '../../../common/pipes/file-signature-validation.pipe';
import { ChatAttachmentSignatureValidationPipe } from '../pipes/chat-attachment-validation.pipe';

@Controller('documents')
export class DocumentIngestionController {
  constructor(private readonly ingestionService: DocumentIngestionService) { }

  /**
   * Jalur 1: Unggah Dokumen Acuan Permanen (Repository Level)
   * Menyimpan dokumen acuan utama daerah ke dalam sistem secara permanen untuk di-vektorisasi (RAG).
   */
  @Post('upload')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: 20 * 1024 * 1024, // Batas aman Multer level 20MB
      },
    }),
  )
  async uploadDocument(
    @UploadedFile(new FileSignatureValidationPipe()) file: Express.Multer.File,
    @Body() dto: UploadDocumentDto,
  ): Promise<{ success: boolean; data: DocumentResponseDto }> {
    const result = await this.ingestionService.processDocumentUpload(file, dto);
    return {
      success: true,
      data: result,
    };
  }

  /**
   * Jalur Baru: Unggah Berkas Transien Sesi (Session/Chat Level)
   * Mendukung penempelan gambar screenshot (Ctrl+V) dan unggah file sementara di tengah obrolan chat.
   * File divalidasi dengan ChatAttachmentSignatureValidationPipe yang mendukung dokumen & gambar.
   */
  @Post('temp-upload')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: 20 * 1024 * 1024, // Batas aman 20MB per berkas
      },
    }),
  )
  async uploadTemporaryFile(
    @UploadedFile(new ChatAttachmentSignatureValidationPipe()) file: Express.Multer.File,
  ): Promise<{
    success: boolean;
    data: {
      tempFileId: string;
      fileName: string;
      mimeType: string;
      fileSizeBytes: string;
      tempPath: string;
    };
  }> {
    const result = await this.ingestionService.processTemporaryUpload(file);
    return {
      success: true,
      data: result,
    };
  }

  @Get()
  async listDocuments(): Promise<{ success: boolean; data: DocumentResponseDto[] }> {
    const result = await this.ingestionService.listAllDocuments();
    return {
      success: true,
      data: result,
    };
  }

  @Get(':id')
  async getDocumentDetails(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<{ success: boolean; data: DocumentResponseDto }> {
    const result = await this.ingestionService.getDocumentDetails(id);
    return {
      success: true,
      data: result,
    };
  }

  @Get(':id/file')
  async streamDocumentFile(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const fileData = await this.ingestionService.getDocumentFile(id);
    res.set({
      'Content-Type': fileData.mimeType,
      'Content-Disposition': `inline; filename="${fileData.fileName}"`,
    });
    const fileStream = createReadStream(fileData.filePath);
    return new StreamableFile(fileStream);
  }

  @Delete(':id')
  async deleteDocument(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<{ success: boolean; message: string }> {
    await this.ingestionService.deleteDocument(id);
    return {
      success: true,
      message: 'Dokumen berhasil dihapus.',
    };
  }
}