import { Injectable, Logger } from '@nestjs/common';
import {
  IIntentHandler,
  IntentType,
  IntentExecutionPayload,
} from '../interfaces/intent-handler.interface';
import { ChatMemoryService } from '../services/chat-memory.service';
import { ArticleGeneratorService } from '../services/article-generator.service';
import { PromptInjectionSanitizer } from '../utils/prompt-injection-sanitizer.util';

@Injectable()
export class ArticleIntentHandler implements IIntentHandler {
  private readonly logger = new Logger(ArticleIntentHandler.name);

  // Fast-Path Heuristic Keyword Regex Matcher (0ms latency)
  private readonly articleTriggersRegex =
    /(?:buatkan|tulis|susun|generate|draft)\s*(?:artikel|opini|berita|press release|rilis media|publikasi|ringkasan eksekutif)/i;

  constructor(
    private readonly sanitizer: PromptInjectionSanitizer,
    private readonly chatMemory: ChatMemoryService,
    private readonly articleGenerator: ArticleGeneratorService,
  ) {}

  getIntentType(): IntentType {
    return 'ARTICLE_GENERATION';
  }

  canHandle(query: string): boolean {
    if (!query) return false;
    return this.articleTriggersRegex.test(query.trim());
  }

  async execute(payload: IntentExecutionPayload): Promise<any> {
    this.logger.log(
      `[ArticleIntentHandler] Memproses Perintah Pembuatan Artikel CoT untuk Sesi ID: ${payload.sessionId}...`,
    );

    // 1. Security Sanitization Check
    const sanitizedInstruction = this.sanitizer.sanitize(payload.query);

    // 2. Record User Message
    await this.chatMemory.recordUserMessage(payload.sessionId, sanitizedInstruction);

    // 3. Execute 2-Step Chain of Thought Article Generator
    const articleResult = await this.articleGenerator.generateArticle({
      documentIds: [payload.documentId],
      articleTitle: 'Draf Artikel Kebijakan',
      userInstruction: sanitizedInstruction,
      tone: 'kritis',
    });

    // 4. Record Assistant Message in DB
    await this.chatMemory.recordAssistantMessage(
      payload.sessionId,
      JSON.stringify(articleResult),
    );

    return {
      intent: this.getIntentType(),
      sessionId: payload.sessionId,
      data: articleResult,
    };
  }
}
