import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { IIntentHandler, IntentExecutionPayload } from '../interfaces/intent-handler.interface';
import { QaIntentHandler } from '../handlers/qa-intent.handler';
import { ArticleIntentHandler } from '../handlers/article-intent.handler';
import { ChatRepository } from '../repositories/chat.repository';

@Injectable()
export class IntentRouterService {
  private readonly logger = new Logger(IntentRouterService.name);
  private readonly handlers: IIntentHandler[];

  constructor(
    private readonly articleHandler: ArticleIntentHandler,
    private readonly qaHandler: QaIntentHandler,
    private readonly chatRepository: ChatRepository,
  ) {
    // Registered in priority order: ArticleIntentHandler first (Fast-path Regex), then QaIntentHandler fallback
    this.handlers = [this.articleHandler, this.qaHandler];
  }

  async dispatch(sessionId: string, query: string): Promise<any> {
    if (!query || query.trim().length === 0) {
      throw new BadRequestException('Pesan atau kueri pengguna tidak boleh kosong.');
    }

    // 1. Fetch ChatSession to retrieve bound documentId
    const session = await this.chatRepository.findSessionById(sessionId);
    if (!session) {
      throw new BadRequestException(`Sesi obrolan dengan ID '${sessionId}' tidak ditemukan.`);
    }

    const payload: IntentExecutionPayload = {
      sessionId: session.id,
      documentId: session.documentId,
      query: query.trim(),
    };

    // 2. Polymorphic Intent Detection (Strategy Pattern)
    const selectedHandler = this.handlers.find((handler) => handler.canHandle(payload.query));

    if (!selectedHandler) {
      this.logger.warn(`Tidak ada handler intent yang cocok untuk kueri: "${query}"`);
      // Fallback to QA Handler
      return this.qaHandler.execute(payload);
    }

    this.logger.log(
      `[IntentRouterService] Kueri: "${query.slice(0, 40)}..." -> Rute Terpilih: [${selectedHandler.getIntentType()}]`,
    );

    return selectedHandler.execute(payload);
  }
}
