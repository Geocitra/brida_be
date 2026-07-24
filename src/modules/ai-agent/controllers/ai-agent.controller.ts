import { Controller, Post, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { AiAgentService } from '../services/ai-agent.service';
import { AnalysisRequestDto } from '../dtos/analysis-request.dto';
import { FinalAnalysisResponse } from '../dtos/analysis-response.dto';

@Controller('ai')
export class AiAgentController {
  constructor(private readonly aiAgentService: AiAgentService) {}

  @Post('analyze')
  @HttpCode(HttpStatus.OK)
  async analyzeDocument(
    @Body() dto: AnalysisRequestDto,
  ): Promise<FinalAnalysisResponse> {
    return this.aiAgentService.executeStaticAnalysis(dto);
  }
}
