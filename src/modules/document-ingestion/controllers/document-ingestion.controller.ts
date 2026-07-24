import {
  Controller,
  Post,
  Get,
  Param,
  UseInterceptors,
  UploadedFile,
  Body,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { DocumentIngestionService } from '../services/document-ingestion.service';
import { UploadDocumentDto } from '../dtos/upload-document.dto';
import { DocumentResponseDto } from '../dtos/document-response.dto';
import { FileSignatureValidationPipe } from '../../../common/pipes/file-signature-validation.pipe';

@Controller('documents')
export class DocumentIngestionController {
  constructor(private readonly ingestionService: DocumentIngestionService) {}

  @Post('upload')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: 20 * 1024 * 1024, // Fail-fast Multer level 20MB max size
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
}
