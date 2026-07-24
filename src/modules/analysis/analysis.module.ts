import { Module } from '@nestjs/common';
import { AnalysisController } from './controllers/analysis.controller';
import { AnalysisMathService } from './services/analysis-math.service';
import { AnalysisCausalService } from './services/analysis-causal.service';
import { AiAgentModule } from '../ai-agent/ai-agent.module';
import { DocumentIngestionModule } from '../document-ingestion/document-ingestion.module';

@Module({
  imports: [AiAgentModule, DocumentIngestionModule],
  controllers: [AnalysisController],
  providers: [AnalysisMathService, AnalysisCausalService],
  exports: [AnalysisMathService, AnalysisCausalService],
})
export class AnalysisModule {}
