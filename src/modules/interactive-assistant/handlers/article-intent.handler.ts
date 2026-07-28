import { Injectable, Logger } from '@nestjs/common';
import {
  IIntentHandler,
  IntentType,
  IntentExecutionPayload,
} from '../interfaces/intent-handler.interface';
import { ChatMemoryService } from '../services/chat-memory.service';
import { ArticleGeneratorService } from '../services/article-generator.service';
import { PromptInjectionSanitizer } from '../utils/prompt-injection-sanitizer.util';
import { QaIntentHandler } from './qa-intent.handler';

@Injectable()
export class ArticleIntentHandler implements IIntentHandler {
  private readonly logger = new Logger(ArticleIntentHandler.name);

  // Pencocokan cepat regex kata kunci pemicu pembuatan artikel (latensi 0ms)
  private readonly articleTriggersRegex =
    /(?:buatkan|tulis|susun|generate|draft|sintesis)\s*(?:artikel|opini|berita|press release|rilis media|publikasi|ringkasan eksekutif|draf)/i;

  constructor(
    private readonly sanitizer: PromptInjectionSanitizer,
    private readonly chatMemory: ChatMemoryService,
    private readonly articleGenerator: ArticleGeneratorService,
    private readonly qaHandler: QaIntentHandler, // Mendelegasikan ke QA Handler sebagai Fallback Multimodal
  ) { }

  getIntentType(): IntentType {
    return 'ARTICLE_GENERATION';
  }

  canHandle(query: string): boolean {
    if (!query) return false;
    return this.articleTriggersRegex.test(query.trim());
  }

  /**
   * Mengeksekusi penulisan artikel terstruktur.
   * Untuk menjaga kompatibilitas fungsional dan pengayaan multimodal, handler ini secara taktis
   * mendelegasikan eksekusi pemrosesan multimodal terpadu ke QaIntentHandler, karena QaIntentHandler
   * kini telah di-upgrade penuh menggunakan sistem skema respons kooperatif Dual-Pane.
   */
  async execute(payload: IntentExecutionPayload): Promise<any> {
    this.logger.log(
      `[ArticleIntentHandler] Mendelegasikan alur penulisan komposit ke Q&A Multimodal Handler untuk menjamin rendering Dual-Pane...`,
    );

    // Delegasikan langsung untuk menjamin single pipeline execution yang kokoh tanpa redundansi logika
    return this.qaHandler.execute(payload);
  }
}