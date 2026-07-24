import { AnalysisResponseDto } from '../schemas/analysis-response.dto';

export interface AnalysisExecutionMetadata {
  executionTimeMs: number;
  estimatedPayloadTokens: number;
  llmProvider: string;
}

export interface FinalAnalysisResponse {
  success: boolean;
  documentId: string;
  data: AnalysisResponseDto;
  metadata: AnalysisExecutionMetadata;
}
