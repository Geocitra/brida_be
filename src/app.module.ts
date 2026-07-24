import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './common/prisma/prisma.module';
import { DocumentIngestionModule } from './modules/document-ingestion/document-ingestion.module';
import { AiAgentModule } from './modules/ai-agent/ai-agent.module';
import { InteractiveAssistantModule } from './modules/interactive-assistant/interactive-assistant.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    PrismaModule,
    DocumentIngestionModule,
    AiAgentModule,
    InteractiveAssistantModule,
  ],
})
export class AppModule {}
