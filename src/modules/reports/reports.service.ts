import { Injectable, Logger, NotFoundException, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { ReportsRepository } from './reports.repository';
import { DocumentRepository } from '../document-ingestion/repositories/document.repository';
import { VendorLlmAdapter } from '../ai-agent/providers/vendor-llm.adapter';
import { GenerateReportDto } from './dto/generate-report.dto';
import { AnalysisMathService } from '../analysis/services/analysis-math.service';
import { AnalysisCausalService } from '../analysis/services/analysis-causal.service';

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);

  constructor(
    private readonly reportsRepository: ReportsRepository,
    private readonly documentRepository: DocumentRepository,
    private readonly llmAdapter: VendorLlmAdapter,
    private readonly mathService: AnalysisMathService,
    private readonly causalService: AnalysisCausalService,
  ) {}

  /**
   * Generates hash string based on sorted array of document IDs.
   * Ensures different order of same documents produces identical hash.
   */
  public generateDocumentIdsHash(documentIds: string[]): string {
    if (!documentIds || documentIds.length === 0) {
      throw new BadRequestException('Minimal satu dokumen acuan harus dipilih.');
    }
    const sorted = [...documentIds].sort();
    return sorted.join('|');
  }

  async checkCache(documentIds: string[], reportType: string = 'NOTA_DINAS_BUPATI') {
    const hash = this.generateDocumentIdsHash(documentIds);
    const cachedReport = await this.reportsRepository.findByHash(hash, reportType);

    if (cachedReport) {
      return {
        isCached: true,
        reportId: cachedReport.id,
        createdAt: cachedReport.createdAt,
        title: cachedReport.title,
        tokenCount: cachedReport.tokenCount,
        sourceDocumentsCount: cachedReport.sources.length,
      };
    }

    return {
      isCached: false,
      reportId: null,
      sourceDocumentsCount: documentIds.length,
    };
  }

  async generateReport(dto: GenerateReportDto) {
    const { documentIds, reportType = 'NOTA_DINAS_BUPATI', title, forceRegenerate = false } = dto;
    const documentIdsHash = this.generateDocumentIdsHash(documentIds);

    // 1. Check DB Cache if forceRegenerate is false
    if (!forceRegenerate) {
      const cached = await this.reportsRepository.findByHash(documentIdsHash, reportType);
      if (cached) {
        this.logger.log(
          `[Report Cache HIT] Laporan untuk hash '${documentIdsHash}' ditemukan di DB. Mengembalikan cache (0 Token LLM).`,
        );
        return {
          success: true,
          isCached: true,
          data: {
            id: cached.id,
            title: cached.title,
            reportType: cached.reportType,
            executiveSummary: cached.executiveSummary,
            contentPayload: cached.contentPayload,
            tokenCount: 0, // Cached = 0 new tokens used
            llmProvider: cached.llmProvider,
            createdAt: cached.createdAt,
            sources: cached.sources.map((s: any) => sanitizeDocument(s.document)),
          },
        };
      }
    }

    // 2. Fetch all referenced documents from database
    this.logger.log(
      `[Report Cache MISS / Regenerate] Mengambil konteks dari ${documentIds.length} dokumen acuan...`,
    );

    const documentsWithText: { id: string; title: string; category: string; text: string }[] = [];
    let combinedTokenEstimate = 0;

    for (const docId of documentIds) {
      const doc = await this.documentRepository.findById(docId);
      if (!doc) {
        throw new NotFoundException(`Dokumen acuan dengan ID '${docId}' tidak ditemukan.`);
      }

      const docText = doc.chunks ? doc.chunks.map((c) => c.rawText).join('\n\n') : '';
      documentsWithText.push({
        id: doc.id,
        title: doc.title,
        category: doc.metadata?.category || 'Umum',
        text: docText,
      });

      combinedTokenEstimate += doc.metadata?.totalTokenCount || docText.length / 4;
    }

    // 3. Assemble Prompt & Payload for LLM Generation
    // 3. Assemble Full-Context Prompt & Payload for LLM Generation (Zero Information Loss)
    const assembledContext = documentsWithText
      .map(
        (d, idx) =>
          `=== DOKUMEN ACUAN ${idx + 1}: ${d.title} (Kategori: ${d.category}) ===\n${d.text}`,
      )
      .join('\n\n--------------------------------------------------\n\n');

    const systemPrompt = `Anda adalah Asisten Analisis Kebijakan Utama untuk Bupati Mimika & Kepala BRIDA.
Tugas Anda: Sintesiskan seluruh informasi faktual dari DOKUMEN ACUAN yang diberikan menjadi Laporan Eksekutif Resmi Nota Dinas Bupati.

PANDUAN STRUKTUR & BIAYA OUTPUT JSON ESEKUTIF PRESISI:
1. "title": Judul laporan resmi eksekutif (Maksimal 15 kata).
2. "executiveSummary": Ringkasan eksekutif padat, faktual, dan solutif (Maksimal 200 - 250 kata).
3. "urgency": "TINGGI" | "SEDANG" | "RENDAH".
4. "recipient": "Bupati Mimika".
5. "sender": "Kepala Badan Riset dan Inovasi Daerah (BRIDA) Kabupaten Mimika".
6. "period": Periode data (e.g. "Triwulan I - IV 2024 / Realtime Analysis").
7. "deviations": TEPAT 3 objek deviasi paling kritis [{ "title": string, "baseline": string, "realization": string, "deviationText": string, "severityColor": string, "causes": string }] (di mana "causes" maksimal 2 kalimat).
8. "nationalPolicyImpact": Object { "policyName": string, "simulationResults": string[] } (maksimal 2 poin ringkas).
9. "actionPriorities": TEPAT 3 poin instruksi / Action Items prioritas utama (masing-masing 1 kalimat).
`;

    const userPrompt = `Dokumen Acuan (${documentsWithText.length} dokumen):\n${documentsAssembled(documentsWithText)}\n\nKonteks Detail Full-Text:\n${assembledContext}`;

    let reportPayload: any;
    let tokensUsed = Math.round(combinedTokenEstimate);
    const llmProvider = this.llmAdapter.getProviderName();

    try {
      const llmResponse = await this.llmAdapter.generateStructuredAnalysis<any>(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        REPORT_OUTPUT_SCHEMA,
      );

      // Sanitize / normalize payload fields
      reportPayload = normalizeReportPayload(llmResponse, documentsWithText);
    } catch (err: any) {
      this.logger.error(`[Report LLM Error] Gagal memanggil LLM: ${err.message}`, err.stack);
      throw new InternalServerErrorException(
        `Gagal membuat laporan dengan AI: ${err.message || 'Layanan AI Gemini tidak dapat dijangkau.'}`,
      );
    }

    // Direct Integration with AnalysisMathService and AnalysisCausalService for 100% mathematical and causal consistency
    if (reportPayload && Array.isArray(reportPayload.deviations)) {
      reportPayload.deviations = await Promise.all(
        reportPayload.deviations.map(async (dev: any) => {
          const targetMatch = dev.baseline ? parseFloat(dev.baseline.replace(/[^0-9.]/g, '')) : NaN;
          const realMatch = dev.realization ? parseFloat(dev.realization.replace(/[^0-9.]/g, '')) : NaN;

          if (!isNaN(targetMatch) && !isNaN(realMatch) && targetMatch > 0) {
            const math = this.mathService.calculate(targetMatch, realMatch, dev.title || 'Indikator');
            let causes = dev.causes;
            try {
              const causal = await this.causalService.analyzeCausalFactors(
                dev.title || 'Indikator',
                math.deviationPercentage,
                documentsWithText[0]?.id,
              );
              if (causal && causal.summary) {
                causes = causal.summary;
              }
            } catch (err: any) {
              this.logger.warn(`Causal service analysis for report deviation skipped: ${err.message}`);
            }

            return {
              ...dev,
              baseline: math.targetText,
              realization: math.realizationText,
              deviationText: `${math.deviationPercentage > 0 ? '+' : ''}${math.deviationPercentage}% Deviasi`,
              severityColor:
                math.urgencyStatus === 'KRITIS'
                  ? 'text-red-700 font-bold'
                  : math.urgencyStatus === 'WASPADA'
                  ? 'text-amber-700 font-bold'
                  : 'text-emerald-700 font-bold',
              causes,
            };
          }
          return dev;
        }),
      );
    }

    const reportTitle =
      title || reportPayload.title || `Laporan Perkembangan Sintesis (${documentsWithText.length} Dokumen Acuan)`;

    // 4. Save newly generated report to Database
    const savedReport = await this.reportsRepository.create({
      title: reportTitle,
      reportType,
      documentIdsHash,
      executiveSummary: reportPayload.executiveSummary || 'Ringkasan eksekutif laporan.',
      contentPayload: reportPayload,
      tokenCount: tokensUsed,
      llmProvider,
      documentIds,
    });

    this.logger.log(
      `[Report Generated & Saved] Laporan berhasil disimpan ke DB dengan ID '${savedReport.id}' (${tokensUsed} Token).`,
    );

    return {
      success: true,
      isCached: false,
      data: {
        id: savedReport.id,
        title: savedReport.title,
        reportType: savedReport.reportType,
        executiveSummary: savedReport.executiveSummary,
        contentPayload: savedReport.contentPayload,
        tokenCount: savedReport.tokenCount,
        llmProvider: savedReport.llmProvider,
        createdAt: savedReport.createdAt,
        sources: savedReport.sources.map((s: any) => sanitizeDocument(s.document)),
      },
    };
  }

  async getAllReports() {
    const reports = await this.reportsRepository.findAll();
    return reports.map((r: any) => ({
      id: r.id,
      title: r.title,
      reportType: r.reportType,
      executiveSummary: r.executiveSummary,
      tokenCount: r.tokenCount,
      llmProvider: r.llmProvider,
      createdAt: r.createdAt,
      sourcesCount: r.sources.length,
      sources: r.sources.map((s: any) => sanitizeDocument(s.document)),
    }));
  }

  async getReportById(id: string) {
    const report = await this.reportsRepository.findById(id);
    if (!report) {
      throw new NotFoundException(`Laporan dengan ID '${id}' tidak ditemukan.`);
    }
    return {
      id: report.id,
      title: report.title,
      reportType: report.reportType,
      executiveSummary: report.executiveSummary,
      contentPayload: report.contentPayload,
      tokenCount: report.tokenCount,
      llmProvider: report.llmProvider,
      createdAt: report.createdAt,
      sources: report.sources.map((s: any) => sanitizeDocument(s.document)),
    };
  }

  async deleteReport(id: string) {
    await this.getReportById(id);
    return this.reportsRepository.delete(id);
  }
}

// Helpers
function documentsAssembled(docs: { id: string; title: string; category: string }[]): string {
  return docs.map((d, i) => `${i + 1}. [${d.category}] ${d.title} (ID: ${d.id})`).join('\n');
}

const REPORT_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    title: { type: 'string' },
    executiveSummary: { type: 'string' },
    urgency: { type: 'string' },
    recipient: { type: 'string' },
    sender: { type: 'string' },
    period: { type: 'string' },
    deviations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          baseline: { type: 'string' },
          realization: { type: 'string' },
          deviationText: { type: 'string' },
          severityColor: { type: 'string' },
          causes: { type: 'string' },
        },
      },
    },
    nationalPolicyImpact: {
      type: 'object',
      properties: {
        policyName: { type: 'string' },
        simulationResults: { type: 'array', items: { type: 'string' } },
      },
    },
    actionPriorities: { type: 'array', items: { type: 'string' } },
  },
  required: ['executiveSummary', 'deviations', 'actionPriorities'],
};

function normalizeReportPayload(raw: any, docs: any[]): any {
  return {
    title: raw.title || `Nota Dinas Hasil Analisis Multidokumen (${docs.length} Dokumen Acuan)`,
    urgency: raw.urgency || 'TINGGI',
    recipient: raw.recipient || 'Bupati Mimika',
    sender: raw.sender || 'Kepala Badan Riset dan Inovasi Daerah (BRIDA) Kabupaten Mimika',
    period: raw.period || 'Hasil Analisis Terintegrasi 2024',
    date: new Date().toLocaleDateString('id-ID', { year: 'numeric', month: 'long', day: 'numeric' }),
    executiveSummary:
      raw.executiveSummary ||
      `Sintesis terintegrasi berdasarkan ${docs.length} dokumen acuan menunjukkan bahwa target indikator makro daerah memerlukan percepatan dan koordinasi lintas instansi.`,
    deviations: Array.isArray(raw.deviations) ? raw.deviations : [],
    nationalPolicyImpact: raw.nationalPolicyImpact || {
      policyName: 'Kebijakan Strategi Nasional Peningkatan Pelayanan Publik & Riset Daerah',
      simulationResults: [
        'Proyeksi peningkatan skor efisiensi riset daerah.',
        'Perlu tindak lanjut supervisi berkala pada proyek fisik berisiko deviasi.',
      ],
    },
    actionPriorities: Array.isArray(raw.actionPriorities) ? raw.actionPriorities : [],
  };
}

function sanitizeDocument(doc: any): any {
  if (!doc) return doc;
  return {
    ...doc,
    metadata: doc.metadata
      ? {
          ...doc.metadata,
          fileSizeBytes: doc.metadata.fileSizeBytes
            ? String(doc.metadata.fileSizeBytes)
            : '0',
        }
      : null,
  };
}

