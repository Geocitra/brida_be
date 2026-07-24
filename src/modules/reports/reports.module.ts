import { Module } from '@nestjs/common';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';
import { ReportsRepository } from './reports.repository';
import { DocumentIngestionModule } from '../document-ingestion/document-ingestion.module';
import { AiAgentModule } from '../ai-agent/ai-agent.module';
import { AnalysisModule } from '../analysis/analysis.module';

@Module({
  imports: [DocumentIngestionModule, AiAgentModule, AnalysisModule],
  controllers: [ReportsController],
  providers: [ReportsService, ReportsRepository],
  exports: [ReportsService, ReportsRepository],
})
export class ReportsModule {}
