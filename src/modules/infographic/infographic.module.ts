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
import { InfographicBrandingService } from './services/infographic-branding.service';
import { InfographicBrandingController } from './controllers/infographic-branding.controller';

import { InfographicController } from './controllers/infographic.controller';
import { InfographicService } from './services/infographic.service';

import { POSTER_RENDERER_TOKEN } from './interfaces/poster-renderer.interface';
import { HtmlPosterRenderer } from './renderers/html-poster.renderer';
import { PosterCompositionService } from './services/poster-composition.service';

@Module({
  imports: [
    PrismaModule,
    AiAgentModule,
    DocumentIngestionModule,
  ],
  controllers: [
    InfographicAgentController,
    InfographicBrandingController,
    InfographicController,
  ],
  providers: [
    InfographicService,
    PosterStorageService,
    ArtDirectorPromptArchitect,
    InfographicAgentService,
    InfographicBrandingService,
    PosterCompositionService,
    {
      provide: POSTER_RENDERER_TOKEN,
      useClass: HtmlPosterRenderer,
    },
    HtmlPosterRenderer,
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
    InfographicBrandingService,
    PosterCompositionService,
    POSTER_RENDERER_TOKEN,
    IMAGE_GENERATOR_TOKEN,
    OpenAiImageAdapter,
  ],
})
export class InfographicModule {}
