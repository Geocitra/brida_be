import { Controller, Post, Get, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { IsString, IsNumber, IsOptional } from 'class-validator';
import { AnalysisMathService } from '../services/analysis-math.service';
import { AnalysisCausalService } from '../services/analysis-causal.service';
import { PrismaService } from '../../../common/prisma/prisma.service';

export class CompareAnalysisDto {
  @IsString()
  indicatorName!: string;

  @IsNumber()
  targetValue!: number;

  @IsNumber()
  realizationValue!: number;

  @IsOptional()
  @IsString()
  sector?: string;

  @IsOptional()
  @IsString()
  unitPrefix?: string;

  @IsOptional()
  @IsString()
  unitSuffix?: string;

  @IsOptional()
  @IsString()
  baselineDocId?: string;

  @IsOptional()
  @IsString()
  realizationDocId?: string;

  @IsOptional()
  documentIds?: string[];
}

@Controller('analysis')
export class AnalysisController {
  constructor(
    private readonly mathService: AnalysisMathService,
    private readonly causalService: AnalysisCausalService,
    private readonly prisma: PrismaService,
  ) {}

  @Get('indicators')
  async getIndicatorMatrix() {
    const baselines = await this.prisma.indicatorBaseline.findMany({
      include: {
        document: {
          include: {
            metadata: true,
          },
        },
      },
    });

    const realizations = await this.prisma.indicatorRealization.findMany({
      include: {
        document: {
          include: {
            metadata: true,
          },
        },
      },
    });

    const realizationMap = new Map<string, (typeof realizations)[0]>();
    for (const real of realizations) {
      realizationMap.set(real.indicatorName.trim().toLowerCase(), real);
    }

    const indicators = baselines.map((base) => {
      const real = realizationMap.get(base.indicatorName.trim().toLowerCase());
      const realizationValue = real ? real.realizationValue : 0;
      const sector = base.document?.metadata?.category || 'Fiskal & Ekonomi';
      const unit = base.unit || real?.unit || '';

      let unitPrefix = '';
      let unitSuffix = unit;
      if (unit === 'M' || unit === 'B' || unit === 'Juta') {
        unitPrefix = 'Rp ';
        unitSuffix = ` ${unit}`;
      } else if (unit === '%') {
        unitPrefix = '';
        unitSuffix = '%';
      }

      const math = this.mathService.calculate(
        base.targetValue,
        realizationValue,
        base.indicatorName,
        sector,
        unitPrefix,
        unitSuffix,
      );

      return {
        id: base.id,
        name: base.indicatorName,
        sector: math.sector,
        baseline: math.targetText,
        realization: math.realizationText,
        deviationPercentage: math.deviationPercentage,
        urgencyStatus: math.urgencyStatus,
        targetValue: base.targetValue,
        realizationValue,
        unitPrefix,
        unitSuffix,
        trendData: [base.targetValue, realizationValue],
        baselineDocId: base.documentId,
        realizationDocId: real?.documentId,
      };
    });

    return {
      success: true,
      data: indicators,
    };
  }

  @Post('compare')
  @HttpCode(HttpStatus.OK)
  async compareDeviation(@Body() dto: CompareAnalysisDto) {
    // 1. Zero-Hallucination Math Engine
    const mathResult = this.mathService.calculate(
      dto.targetValue,
      dto.realizationValue,
      dto.indicatorName,
      dto.sector || 'Fiskal & Ekonomi',
      dto.unitPrefix || 'Rp ',
      dto.unitSuffix || ' M',
    );

    // 2. AI Causal Inference & Recommendation Engine
    const causalResult = await this.causalService.analyzeCausalFactors(
      dto.indicatorName,
      mathResult.deviationPercentage,
      dto.baselineDocId,
      dto.realizationDocId,
    );

    return {
      success: true,
      data: {
        math: mathResult,
        causal: causalResult,
      },
    };
  }
}
