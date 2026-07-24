import { Module } from '@nestjs/common';
import { AiAgentModule } from '../ai-agent/ai-agent.module';
import { ChatRepository } from './repositories/chat.repository';
import { ChatMemoryService } from './services/chat-memory.service';
import { QaIntentHandler } from './handlers/qa-intent.handler';
import { ArticleIntentHandler } from './handlers/article-intent.handler';
import { IntentRouterService } from './services/intent-router.service';
import { AssistantController } from './controllers/assistant.controller';
import { PromptInjectionSanitizer } from './utils/prompt-injection-sanitizer.util';
import { ArticleGeneratorService } from './services/article-generator.service';

@Module({
  imports: [AiAgentModule],
  controllers: [AssistantController],
  providers: [
    ChatRepository,
    ChatMemoryService,
    PromptInjectionSanitizer,
    ArticleGeneratorService,
    QaIntentHandler,
    ArticleIntentHandler,
    IntentRouterService,
  ],
  exports: [
    ChatRepository,
    ChatMemoryService,
    PromptInjectionSanitizer,
    ArticleGeneratorService,
    QaIntentHandler,
    ArticleIntentHandler,
    IntentRouterService,
  ],
})
export class InteractiveAssistantModule {}
