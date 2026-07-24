import { Module } from '@nestjs/common';
import { DocumentIngestionModule } from '../document-ingestion/document-ingestion.module';
import { VectorRetrievalService } from './services/vector-retrieval.service';
import { TokenEstimatorUtil } from './utils/token-estimator.util';
import { PromptAssemblyBuilder } from './utils/prompt-assembly.builder';
import { ContextAssemblyService } from './services/context-assembly.service';
import { NetworkResilienceUtil } from './utils/network-resilience.util';
import { VendorLlmAdapter } from './providers/vendor-llm.adapter';
import { AiAgentService } from './services/ai-agent.service';
import { AiAgentController } from './controllers/ai-agent.controller';

@Module({
  imports: [DocumentIngestionModule],
  controllers: [AiAgentController],
  providers: [
    VectorRetrievalService,
    TokenEstimatorUtil,
    PromptAssemblyBuilder,
    ContextAssemblyService,
    NetworkResilienceUtil,
    VendorLlmAdapter,
    AiAgentService,
  ],
  exports: [
    VectorRetrievalService,
    TokenEstimatorUtil,
    PromptAssemblyBuilder,
    ContextAssemblyService,
    NetworkResilienceUtil,
    VendorLlmAdapter,
    AiAgentService,
  ],
})
export class AiAgentModule {}
