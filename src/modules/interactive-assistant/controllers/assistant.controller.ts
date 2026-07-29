import {
  Controller,
  Get,
  Post,
  Delete,
  Patch,
  Body,
  Param,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { IntentRouterService } from '../services/intent-router.service';
import { ChatMemoryService } from '../services/chat-memory.service';
import { ArticleGeneratorService } from '../services/article-generator.service';
import { DiscussionBridgeService } from '../services/discussion-bridge.service';
import { DocumentIngestionService } from '../../document-ingestion/services/document-ingestion.service';
import { ChatAttachmentSignatureValidationPipe } from '../../document-ingestion/pipes/chat-attachment-validation.pipe';
import { ArticleLength, SessionType } from '@prisma/client';

// Impor DTO tervalidasi ketat untuk mendukung muatan kolaboratif multimodal
import { IsString, IsNotEmpty, IsUUID, MinLength, IsOptional, IsArray, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';

export class AttachmentItemDto {
  @IsUUID('4', { message: 'fileId harus berupa format UUID v4 yang valid' })
  @IsNotEmpty({ message: 'fileId tidak boleh kosong' })
  fileId!: string;

  @IsOptional()
  @IsString()
  classification?: 'BASELINE' | 'REALIZATION' | 'GENERAL_REFERENCE';
}

export class ExtendedInteractRequestDto {
  @IsUUID('4', { message: 'sessionId harus berupa format UUID v4 yang valid' })
  @IsNotEmpty({ message: 'sessionId tidak boleh kosong' })
  sessionId!: string;

  @IsString()
  @IsNotEmpty({ message: 'Pesan atau perintah tidak boleh kosong' })
  @MinLength(2, { message: 'Pesan minimal 2 karakter' })
  query!: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AttachmentItemDto)
  attachments?: AttachmentItemDto[];

  @IsOptional()
  @IsString()
  currentDraft?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  documentIds?: string[];

  @IsOptional()
  @IsString()
  tone?: string;

  @IsOptional()
  @IsString()
  targetLength?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  districts?: string[];
}

@Controller('assistant')
export class AssistantController {
  constructor(
    private readonly routerService: IntentRouterService,
    private readonly memoryService: ChatMemoryService,
    private readonly articleGeneratorService: ArticleGeneratorService,
    private readonly discussionBridgeService: DiscussionBridgeService,
    private readonly ingestionService: DocumentIngestionService, // Injeksi baru untuk transient files
  ) { }

  @Post('session')
  @HttpCode(HttpStatus.CREATED)
  async createSession(
    @Body('documentId') documentId?: string,
    @Body('documentIds') documentIds?: string[],
    @Body('title') title?: string,
    @Body('sessionType') sessionType?: SessionType,
  ) {
    const targetIds = documentIds && documentIds.length > 0 ? documentIds : (documentId ? [documentId] : []);
    const type = sessionType || SessionType.QA_CHAT;
    const session = await this.memoryService.createSession(targetIds, title, type);
    return {
      success: true,
      data: session,
    };
  }

  /**
   * Endpoint Baru: POST /assistant/sessions/:id/attachments
   * Menerima unggahan gambar clipboard (Ctrl+V) atau file transien khusus di sesi aktif.
   */
  @Post('sessions/:id/attachments')
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(
    FileInterceptor('file', {
      limits: {
        fileSize: 20 * 1024 * 1024, // Maksimal 20MB per berkas
      },
    }),
  )
  async uploadSessionAttachment(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @UploadedFile(new ChatAttachmentSignatureValidationPipe()) file: Express.Multer.File,
  ) {
    // Validasi eksistensi sesi terlebih dahulu sebelum menulis file fisik (Prevent orphaned files)
    await this.memoryService.getQaSessionDetails(id);

    const result = await this.ingestionService.processTemporaryUpload(file);
    return {
      success: true,
      data: {
        ...result,
        sessionId: id,
      },
    };
  }

  /**
   * Endpoint Obrolan Kolaboratif AI Agent Utama
   * Menerima kueri tekstual, draf aktif, dan daftar berkas sementara untuk dieksekusi.
   */
  @Post('interact')
  @HttpCode(HttpStatus.OK)
  async interact(@Body() dto: ExtendedInteractRequestDto) {
    if (dto.documentIds) {
      await this.memoryService.syncSessionDocuments(dto.sessionId, dto.documentIds);
    }
    if (dto.tone || dto.targetLength) {
      await this.memoryService.updateSessionMetadata(dto.sessionId, dto.tone, dto.targetLength);
    }
    const result = await this.routerService.dispatch(
      dto.sessionId,
      dto.query,
      dto.attachments,
      dto.currentDraft,
      dto.districts,
    );
    return {
      success: true,
      data: result,
    };
  }

  // --- QA Chat Session History Endpoints ---

  @Get('sessions')
  async getAllQaSessions() {
    const data = await this.memoryService.getQaSessions();
    return {
      success: true,
      data,
    };
  }

  @Get('sessions/:id')
  async getQaSessionById(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    const data = await this.memoryService.getQaSessionDetails(id);
    return {
      success: true,
      data,
    };
  }

  @Delete('sessions/:id')
  async deleteQaSession(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    await this.memoryService.deleteSession(id);
    return {
      success: true,
      message: `Sesi Q&A ID '${id}' berhasil dihapus.`,
    };
  }

  // --- Article Generator Endpoints ---

  @Post('article/generate')
  @HttpCode(HttpStatus.OK)
  async generateArticle(
    @Body()
    body: {
      documentIds: string[];
      articleTitle: string;
      targetLength?: 'SHORT' | 'MEDIUM' | 'LONG';
      tone?: string;
      userInstruction?: string;
      sessionId?: string;
    },
  ) {
    const result = await this.articleGeneratorService.generateArticle(body);
    return {
      success: true,
      data: result,
    };
  }

  @Post('article/transition')
  @HttpCode(HttpStatus.CREATED)
  async transitionQaToArticle(
    @Body()
    body: {
      sessionId: string;
      articleTitle: string;
      targetLength?: ArticleLength;
      tone?: string;
      userInstruction?: string;
    },
  ) {
    const result = await this.discussionBridgeService.transitionQaToArticle(body);
    return {
      success: true,
      data: result,
    };
  }

  @Post('article/interact')
  @HttpCode(HttpStatus.OK)
  async interactArticle(
    @Body() body: { sessionId: string; userInstruction: string },
  ) {
    const result = await this.articleGeneratorService.interactWithArticleSession(
      body.sessionId,
      body.userInstruction,
    );
    return {
      success: true,
      data: result,
    };
  }

  @Get('article/sessions')
  async getAllArticleSessions() {
    const data = await this.articleGeneratorService.getAllArticleSessions();
    return {
      success: true,
      data,
    };
  }

  @Get('article/sessions/:id')
  async getArticleSessionById(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    const data = await this.articleGeneratorService.getArticleSessionById(id);
    return {
      success: true,
      data,
    };
  }

  /**
   * Endpoint PATCH untuk pembaruan manual naskah draf artikel (Two-Way Sync)
   * Menyimpan draf mentah hasil suntingan manual pengguna dari Pane Kanan ke database.
   */
  @Patch('article/sessions/:id/content')
  @HttpCode(HttpStatus.OK)
  async updateArticleContent(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body()
    body: {
      articleTitle: string;
      fullArticleText: string;
    },
  ) {
    const result = await this.articleGeneratorService.updateArticleContent(
      id,
      body.articleTitle,
      body.fullArticleText,
    );
    return {
      success: true,
      data: result,
    };
  }

  @Delete('article/sessions/:id')
  async deleteArticleSession(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    await this.articleGeneratorService.deleteArticleSession(id);
    return {
      success: true,
      message: `Sesi artikel ID '${id}' berhasil dihapus.`,
    };
  }

  @Get('article/sessions/:id/export-data')
  async getArticleExportData(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) {
    const data = await this.articleGeneratorService.getArticleSessionById(id);
    return {
      success: true,
      data: {
        title: data.articleTitle,
        content: data.fullArticleText,
        tone: data.tone,
        generatedAt: data.updatedAt,
      },
    };
  }
}