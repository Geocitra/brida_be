import { Controller, Post, Get, Body, HttpCode, HttpStatus, Logger } from '@nestjs/common';
import { IsString, IsNumber, IsOptional, IsArray } from 'class-validator';
import { AnalysisMathService } from '../services/analysis-math.service';
import { AnalysisCausalService } from '../services/analysis-causal.service';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { SessionType } from '@prisma/client';

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
  private readonly logger = new Logger(AnalysisController.name);

  constructor(
    private readonly mathService: AnalysisMathService,
    private readonly causalService: AnalysisCausalService,
    private readonly prisma: PrismaService,
  ) { }

  /**
   * GET /analysis/dashboard-meta
   * Mengagregasi data token komputasi AI daerah secara terpusat (NotebookLM Paradigm)
   * serta menyajikan riwayat aktivitas terbaru yang minim kopling.
   */
  @Get('dashboard-meta')
  async getDashboardMetadata() {
    try {
      this.logger.log('[AnalysisController] Mengagregasi metadata statistik dashboard eksekutif...');

      // 1. Eksekusi Kueri Spasial & Transaksional secara Paralel (Lightning Fast I/O < 100ms)
      const [
        aiLogsSum,
        reportsSum,
        recentChatsRaw,
        recentArticlesRaw
      ] = await Promise.all([
        this.prisma.aiAnalysisLog.aggregate({
          _sum: { tokenCount: true }
        }),
        this.prisma.generatedReport.aggregate({
          _sum: { tokenCount: true }
        }),
        this.prisma.chatSession.findMany({
          where: { sessionType: SessionType.QA_CHAT },
          orderBy: { updatedAt: 'desc' },
          take: 5,
          include: {
            document: { select: { id: true, title: true } },
            sources: {
              include: {
                document: { select: { id: true, title: true } }
              }
            },
            messages: {
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: { content: true }
            }
          }
        }),
        this.prisma.chatSession.findMany({
          where: { sessionType: SessionType.ARTICLE_GENERATOR },
          orderBy: { updatedAt: 'desc' },
          take: 5,
          include: {
            document: { select: { id: true, title: true } },
            sources: {
              include: {
                document: { select: { id: true, title: true } }
              }
            },
            messages: {
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: { content: true }
            }
          }
        })
      ]);

      // 2. Penghitungan Anggaran Token Sesuai Aturan Sistem (Information Expert)
      const aiTokens = aiLogsSum._sum?.tokenCount || 0;
      const reportTokens = reportsSum._sum?.tokenCount || 0;
      const totalTokens = aiTokens + reportTokens;
      const tokenBudget = this.mathService.calculateTokenBudget(totalTokens);

      // 3. Mapping Riwayat Obrolan Aktif (AI Chat)
      const recentChats = recentChatsRaw.map((session) => {
        const lastMsgRaw = session.messages[0]?.content || '';
        let lastMessageText = 'Belum ada pesan.';

        if (lastMsgRaw) {
          try {
            const parsed = JSON.parse(lastMsgRaw);
            if (parsed && typeof parsed === 'object') {
              lastMessageText = parsed.answer || parsed.fullArticleText || lastMsgRaw;
            }
          } catch {
            lastMessageText = lastMsgRaw;
          }
        }

        const sourceTitles = session.sources.map((s) => s.document.title);
        if (session.document && !sourceTitles.includes(session.document.title)) {
          sourceTitles.unshift(session.document.title);
        }

        return {
          id: session.id,
          title: session.title,
          lastMessage: lastMessageText,
          updatedAt: session.updatedAt,
          sourcesCount: sourceTitles.length,
          sources: sourceTitles,
        };
      });

      // 4. Mapping Riwayat Pembuatan Naskah Aktif (Artikel Generator)
      const recentArticles = recentArticlesRaw.map((session) => {
        const lastMsgRaw = session.messages[0]?.content || '';
        let snippetText = session.currentDraft || '';

        if (!snippetText && lastMsgRaw) {
          try {
            const parsed = JSON.parse(lastMsgRaw);
            if (parsed && typeof parsed === 'object') {
              snippetText = parsed.updatedArticle?.draftMarkdown || parsed.fullArticleText || lastMsgRaw;
            }
          } catch {
            snippetText = lastMsgRaw;
          }
        }

        const sourceTitles = session.sources.map((s) => s.document.title);
        if (session.document && !sourceTitles.includes(session.document.title)) {
          sourceTitles.unshift(session.document.title);
        }

        return {
          id: session.id,
          title: session.articleTitle || session.title,
          snippet: snippetText.slice(0, 150) + (snippetText.length > 150 ? '...' : ''),
          updatedAt: session.updatedAt,
          sourcesCount: sourceTitles.length,
          sources: sourceTitles,
          tone: session.tone,
          targetLength: session.targetLength,
        };
      });

      return {
        success: true,
        data: {
          tokenBudget,
          recentChats,
          recentArticles
        }
      };
    } catch (err: any) {
      this.logger.error(`[Dashboard Meta Aggregation Failed]: ${err.message}`, err.stack);
      throw err;
    }
  }

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
    const mathResult = this.mathService.calculate(
      dto.targetValue,
      dto.realizationValue,
      dto.indicatorName,
      dto.sector || 'Fiskal & Ekonomi',
      dto.unitPrefix || 'Rp ',
      dto.unitSuffix || ' M',
    );

    let resolvedBaselineId = dto.baselineDocId;
    let resolvedRealizationId = dto.realizationDocId;

    if (
      (!resolvedBaselineId || !resolvedRealizationId) &&
      dto.documentIds &&
      dto.documentIds.length > 0
    ) {
      const docs = await this.prisma.reportDocument.findMany({
        where: {
          id: { in: dto.documentIds },
        },
        include: {
          metadata: true,
        },
      });

      if (!resolvedBaselineId) {
        const foundBaseline = docs.find((d) => d.metadata?.docType === 'BASELINE');
        if (foundBaseline) {
          resolvedBaselineId = foundBaseline.id;
        } else if (docs.length > 0) {
          resolvedBaselineId = docs[0].id;
        }
      }

      if (!resolvedRealizationId) {
        const foundRealization = docs.find((d) => d.metadata?.docType === 'REALIZATION');
        if (foundRealization) {
          resolvedRealizationId = foundRealization.id;
        } else if (docs.length > 0) {
          resolvedRealizationId = docs[1]?.id || docs[0].id;
        }
      }
    }

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