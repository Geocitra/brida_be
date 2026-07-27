import { Controller, Post, Get, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { IsString, IsNumber, IsOptional, IsArray } from 'class-validator';
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
  @IsArray()
  @IsString({ each: true })
  documentIds?: string[];
}

@Controller('analysis')
export class AnalysisController {
  constructor(
    private readonly mathService: AnalysisMathService,
    private readonly causalService: AnalysisCausalService,
    private readonly prisma: PrismaService,
  ) { }

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

    // 2. Resolusi Peran Dokumen secara Cerdas (Fallback & Auto-Detection)
    let resolvedBaselineId = dto.baselineDocId;
    let resolvedRealizationId = dto.realizationDocId;

    // Jika salah satu ID kosong, tetapi frontend mengirimkan kumpulan documentIds mentah
    if (
      (!resolvedBaselineId || !resolvedRealizationId) &&
      dto.documentIds &&
      dto.documentIds.length > 0
    ) {
      // Ambil metadata dari PostgreSQL untuk mendeteksi 'docType' dokumen yang diteruskan
      const docs = await this.prisma.reportDocument.findMany({
        where: {
          id: { in: dto.documentIds },
        },
        include: {
          metadata: true,
        },
      });

      // Deteksi otomatis untuk Baseline
      if (!resolvedBaselineId) {
        const foundBaseline = docs.find((d) => d.metadata?.docType === 'BASELINE');
        if (foundBaseline) {
          resolvedBaselineId = foundBaseline.id;
        } else if (docs.length > 0) {
          // Fallback teraman: Gunakan dokumen pertama dalam antrean
          resolvedBaselineId = docs[0].id;
        }
      }

      // Deteksi otomatis untuk Realisasi
      if (!resolvedRealizationId) {
        const foundRealization = docs.find((d) => d.metadata?.docType === 'REALIZATION');
        if (foundRealization) {
          resolvedRealizationId = foundRealization.id;
        } else if (docs.length > 0) {
          // Fallback teraman: Gunakan dokumen kedua (jika ada), atau gunakan dokumen pertama
          resolvedRealizationId = docs[1]?.id || docs[0].id;
        }
      }
    }

    // 3. AI Causal Inference & Recommendation Engine
    const causalResult = await this.causalService.analyzeCausalFactors(
      dto.indicatorName,
      mathResult.deviationPercentage,
      resolvedBaselineId,
      resolvedRealizationId,
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