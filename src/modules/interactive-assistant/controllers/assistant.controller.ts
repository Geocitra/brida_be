import {
  Controller,
  Get,
  Post,
  Delete,
  Patch, // Impor baru dekorator Patch untuk modifikasi parsial [1]
  Body,
  Param,
  HttpCode,
  HttpStatus,
  ParseUUIDPipe,
} from '@nestjs/common';
import { IntentRouterService } from '../services/intent-router.service';
import { ChatMemoryService } from '../services/chat-memory.service';
import { ArticleGeneratorService } from '../services/article-generator.service';
import { InteractRequestDto } from '../dtos/interact-request.dto';

@Controller('assistant')
export class AssistantController {
  constructor(
    private readonly routerService: IntentRouterService,
    private readonly memoryService: ChatMemoryService,
    private readonly articleGeneratorService: ArticleGeneratorService,
  ) { }

  @Post('session')
  @HttpCode(HttpStatus.CREATED)
  async createSession(
    @Body('documentId') documentId?: string,
    @Body('documentIds') documentIds?: string[],
    @Body('title') title?: string,
  ) {
    const targetIds = documentIds && documentIds.length > 0 ? documentIds : (documentId ? [documentId] : []);
    const session = await this.memoryService.createSession(targetIds, title);
    return {
      success: true,
      data: session,
    };
  }

  @Post('interact')
  @HttpCode(HttpStatus.OK)
  async interact(@Body() dto: InteractRequestDto) {
    const result = await this.routerService.dispatch(dto.sessionId, dto.query);
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
   * Endpoint PATCH Baru untuk pembaruan manual naskah draf artikel (Two-Way Sync) [1].
   * Membuka rute modifikasi parsial aman dengan pipa validasi UUID v4 [1].
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
}