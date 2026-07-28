import { Module } from '@nestjs/common';
import { DocumentIngestionModule } from '../document-ingestion/document-ingestion.module';
import { AiAgentModule } from '../ai-agent/ai-agent.module';
import { ChatRepository } from './repositories/chat.repository';
import { ChatMemoryService } from './services/chat-memory.service';
import { QaIntentHandler } from './handlers/qa-intent.handler';
import { ArticleIntentHandler } from './handlers/article-intent.handler';
import { IntentRouterService } from './services/intent-router.service';
import { AssistantController } from './controllers/assistant.controller';
import { PromptInjectionSanitizer } from './utils/prompt-injection-sanitizer.util';
import { ArticleGeneratorService } from './services/article-generator.service';
import { DiscussionBridgeService } from './services/discussion-bridge.service';
import { TranscriptDistiller } from './utils/transcript-distiller.util';

@Module({
  imports: [DocumentIngestionModule, AiAgentModule],
  controllers: [AssistantController],
  providers: [
    ChatRepository,
    ChatMemoryService,
    PromptInjectionSanitizer,
    ArticleGeneratorService,
    DiscussionBridgeService, // Registrasi Mediator Transisi Baru
    TranscriptDistiller,     // Registrasi Utilitas Distilasi Baru
    QaIntentHandler,
    ArticleIntentHandler,
    IntentRouterService,
  ],
  exports: [
    ChatRepository,
    ChatMemoryService,
    PromptInjectionSanitizer,
    ArticleGeneratorService,
    DiscussionBridgeService, // Ekspor untuk fleksibilitas integrasi lintas modul
    TranscriptDistiller,     // Ekspor untuk pemanfaatan di modul analisis eksternal
    QaIntentHandler,
    ArticleIntentHandler,
    IntentRouterService,
  ],
})
export class InteractiveAssistantModule { }