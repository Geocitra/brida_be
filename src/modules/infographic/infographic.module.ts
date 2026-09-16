import { Module } from '@nestjs/common';
import { PrismaModule } from '../../common/prisma/prisma.module';
import { AiAgentModule } from '../ai-agent/ai-agent.module';
import { DocumentIngestionModule } from '../document-ingestion/document-ingestion.module';

import { PosterStorageService } from './services/poster-storage.service';
import { ArtDirectorPromptArchitect } from './services/art-director.service';
import { OpenAiImageAdapter } from './providers/openai-image.adapter';
import { IMAGE_GENERATOR_TOKEN } from './interfaces/image-generator.interface';

import { InfographicAgentService } from './services/infographic-agent.service';
import { InfographicAgentController } from './controllers/infographic-agent.controller';

import { InfographicController } from './controllers/infographic.controller';
import { InfographicService } from './services/infographic.service';

@Module({
  imports: [
    PrismaModule,
    AiAgentModule,
    DocumentIngestionModule,
  ],
  controllers: [
    InfographicAgentController,
    InfographicController,
  ],
  providers: [
    InfographicService,
    PosterStorageService,
    ArtDirectorPromptArchitect,
    InfographicAgentService,
    {
      provide: IMAGE_GENERATOR_TOKEN,
      useClass: OpenAiImageAdapter,
    },
    OpenAiImageAdapter,
  ],
  exports: [
    InfographicService,
    PosterStorageService,
    ArtDirectorPromptArchitect,
    InfographicAgentService,
    IMAGE_GENERATOR_TOKEN,
    OpenAiImageAdapter,
  ],
})
export class InfographicModule {}
