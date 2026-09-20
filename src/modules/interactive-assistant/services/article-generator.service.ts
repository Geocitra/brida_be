import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { DocumentRepository } from '../../document-ingestion/repositories/document.repository';
import { VendorLlmAdapter } from '../../ai-agent/providers/vendor-llm.adapter';
import { ChatRepository } from '../repositories/chat.repository';
import { TokenEstimatorUtil } from '../../ai-agent/utils/token-estimator.util';
import { ArticleLength, MessageRole, SessionType } from '@prisma/client';
import { UrlScraperService } from './url-scraper.service';
import { DocumentIngestionService } from '../../document-ingestion/services/document-ingestion.service';
import { ContextAssemblyService } from '../../ai-agent/services/context-assembly.service';
import { WebSearchService } from './web-search.service';

import { EDITORIAL_STYLE_GUIDE } from '../../ai-agent/constants/system-prompts.constant';
import { sanitizeQuickChartMarkdown } from '../utils/quickchart-sanitizer.util';

export interface GenerateArticleOptions {
  documentIds: string[];
  articleTitle?: string;
  targetLength?: 'SHORT' | 'MEDIUM' | 'LONG' | ArticleLength;
  tone?: string;
  userInstruction?: string;
  sessionId?: string;
  synthesizedManifest?: {
    tesisUtama: string;
    argumenKunci: Array<{
      fakta: string;
      sitasiAsli: string;
    }>;
    kesimpulanRingkas?: string;
  };
  parentSessionId?: string;
  userId?: string;
}

export interface OutlineChapter {
  nomorBab: string;
  judulBab: string;
  targetKata: number;
  fokusSubstansi: string;
  instruksiKhusus: string;
}

export interface OutlineResult {
  judulUsulan: string;
  ringkasan: string;
  daftarBab: OutlineChapter[];
  chartHints?: string;
}

const OUTLINE_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    judulUsulan: {
      type: 'string',
      description: 'Judul resmi naskah kebijakan yang bernas, lugas, dan profesional (tanpa prefix "Judul:").',
    },
    ringkasan: {
      type: 'string',
      description: 'Ringkasan eksekutif 1-2 paragraf padat intisari naskah.',
    },
    daftarBab: {
      type: 'array',
      description: 'Daftar bab-bab utama naskah yang terstruktur rapi untuk mencapai target kata minimum yang diminta.',
      items: {
        type: 'object',
        properties: {
          nomorBab: { type: 'string', description: 'Nomor bab angka Romawi: I, II, III, IV, dst.' },
          judulBab: { type: 'string', description: 'Judul bab yang spesifik dan berbobot.' },
          targetKata: { type: 'number', description: 'Target jumlah kata minimum untuk bab ini (misal 500-600).' },
          fokusSubstansi: { type: 'string', description: 'Poin-poin masalah, data, dan substansi utama yang wajib diuraikan di bab ini.' },
          instruksiKhusus: { type: 'string', description: 'Instruksi penyajian: wajib tabel data, analisis sebab-akibat, landasan hukum, atau butir rekomendasi.' },
        },
        required: ['nomorBab', 'judulBab', 'targetKata', 'fokusSubstansi', 'instruksiKhusus'],
      },
    },
    chartHints: {
      type: 'string',
      description: 'Daftar judul/topik visualisasi data QuickChart yang relevan, dipisah koma. Kosongkan jika tidak ada data numerik.',
    },
  },
  required: ['judulUsulan', 'ringkasan', 'daftarBab', 'chartHints'],
};

const CHAPTER_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    nomorBab: { type: 'string', description: 'Nomor bab Romawi' },
    judulBab: { type: 'string', description: 'Judul bab' },
    isiBabMarkdown: {
      type: 'string',
      description:
        'Isi lengkap naskah bab dalam format Markdown (diawali heading 2: "## {nomorBab}. {judulBab}"). ' +
        'Wajib elaboratif, mendalam, kaya data, menggunakan tabel Markdown jika menyajikan komparasi indikator, ' +
        'dan memenuhi target jumlah kata minimum. DILARANG membuat teks ringkas atau memotong di tengah kalimat.',
    },
  },
  required: ['nomorBab', 'judulBab', 'isiBabMarkdown'],
};

const ARTICLE_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    judulUsulan: {
      type: 'string',
      description:
        'Judul resmi naskah kebijakan/artikel yang bernas, lugas, dan profesional (TANPA prefix kata "Judul:" atau "Pendahuluan").',
    },
    ringkasan: {
      type: 'string',
      description: 'Ringkasan eksekutif 1-2 paragraf padat intisari naskah.',
    },
    fullText: {
      type: 'string',
      description:
        'Isi naskah dokumen utuh lengkap dalam format Markdown. ' +
        'WAJIB diawali dengan judul utama menggunakan heading 1 (# Judul Utama Dokumen) yang persis sama dengan judulUsulan. ' +
        'Setelah itu cantumkan baris identitas penyusun (**Disusun oleh: Badan Riset dan Inovasi Daerah (BRIDA) Kabupaten Mimika**), baru kemudian masuk ke ## I. Ringkasan Eksekutif atau ## II. Pendahuluan. ' +
        'DILARANG MENJADIKAN KATA "PENDAHULUAN" SEBAGAI HEADING 1 (#). ' +
        'BEBAS BEREKSPRESI DENGAN KEKAYAAN FORMAT: Sangat dianjurkan menggunakan tabel Markdown, poin analitis (bullet/numbered lists), dan narasi mendalam. ' +
        'CHART DILARANG disisipkan langsung di sini — chart akan ditambahkan secara terpisah. ' +
        'KEPADATAN SUBSTANSI: Setiap bab utama (##) WAJIB memiliki pembahasan yang bernilai minimal 150 kata (akumulasi bebas dari narasi, tabel data, dan butir analitis). ' +
        'DILARANG membuat sub-heading kecil yang hanya berisi 1-2 kalimat pendek tanpa elaborasi substansi. ' +
        'TIDAK PERLU mencantumkan bab daftar pustaka/referensi di akhir teks atau token sitasi mesin; manfaatkan seluruh kuota kata untuk analisis tuntas. ' +
        'WAJIB menulis sampai SELESAI — jangan potong di tengah kalimat atau paragraf. Akhiri dengan paragraf penutup yang tuntas.',
    },
    chartHints: {
      type: 'string',
      description:
        'Daftar judul/topik chart yang sebaiknya disisipkan ke dalam naskah, dipisah koma. ' +
        'Contoh: "Perbandingan Curah Hujan 2024-2026, Prevalensi Stunting per Distrik". ' +
        'Kosongkan jika tidak ada data yang cocok untuk divisualisasikan.',
    },
  },
  required: ['judulUsulan', 'ringkasan', 'fullText', 'chartHints'],
};

/**
 * Schema khusus untuk generate QuickChart URL secara terpisah dari teks utama.
 * Ini memisahkan token budget chart dari token budget teks narasi.
 */
const CHART_GENERATION_SCHEMA = {
  type: 'object',
  properties: {
    charts: {
      type: 'string',
      description:
        'String Markdown berisi satu atau lebih gambar QuickChart dalam format: ' +
        '![Judul Chart](https://quickchart.io/chart?c=...) ' +
        'Setiap chart dipisahkan dengan newline ganda. ' +
        'Hasilkan chart yang sesuai dengan topik yang diminta. ' +
        'Gunakan data numerik nyata atau estimasi realistis.',
    },
  },
  required: ['charts'],
};

@Injectable()
export class ArticleGeneratorService {
  private readonly logger = new Logger(ArticleGeneratorService.name);
  private readonly MAX_DRAFTING_TOKEN_BUDGET = 150000;

  /**
   * Mapping token limit per target length.
   * - SHORT  (~750 kata)       → 6.144 token output (~4x overhead)
   * - MEDIUM (~1.500 kata)     → 14.336 token output (~4x overhead)
   * - LONG   (~3.000-4.500 kata) → 32.768 token output (max untuk artikel panjang)
   * Chart generate menggunakan token terpisah (4.096 token)
   */
  private readonly TOKEN_BUDGET_BY_LENGTH: Record<string, number> = {
    SHORT: 6144,
    MEDIUM: 14336,
    LONG: 32768,
  };

  private readonly CHART_TOKEN_BUDGET = 4096;

  constructor(
    private readonly documentRepository: DocumentRepository,
    private readonly chatRepository: ChatRepository,
    private readonly llmAdapter: VendorLlmAdapter,
    private readonly tokenEstimator: TokenEstimatorUtil,
    private readonly urlScraperService: UrlScraperService,
    private readonly ingestionService: DocumentIngestionService,
    private readonly contextAssembly: ContextAssemblyService,
    private readonly webSearchService: WebSearchService,
  ) { }

  async generateArticle(options: GenerateArticleOptions): Promise<any> {
    const {
      documentIds,
      articleTitle,
      targetLength = ArticleLength.MEDIUM,
      tone = 'solutif',
      userInstruction,
      synthesizedManifest,
      parentSessionId,
    } = options;

    const validDocIds = [...(documentIds || [])];
    let normalizedTitle =
      (articleTitle || '').trim() || 'Draf Kebijakan Publikasi';

    let session = options.sessionId
      ? await this.chatRepository.findSessionById(options.sessionId, options.userId)
      : null;

    if (options.sessionId && !session) {
      throw new NotFoundException(`Sesi artikel ID '${options.sessionId}' tidak ditemukan.`);
    }

    if (!session) {
      session = await this.chatRepository.createArticleSession({
        userId: options.userId,
        documentIds: validDocIds,
        articleTitle: normalizedTitle,
        targetLength: targetLength as ArticleLength,
        tone,
        initialPrompt: userInstruction,
        parentSessionId,
      });
    }

    const URL_REGEX = /https?:\/\/[^\s]+/gi;
    const foundUrls = (userInstruction || '').match(URL_REGEX) || [];
    const scrapedUrls: Array<{ url: string; title: string; text: string }> = [];

    if (foundUrls.length > 0) {
      for (const url of foundUrls) {
        try {
          const scraped = await this.urlScraperService.scrapeAndExtract(url);
          scrapedUrls.push({
            url: scraped.sourceUrl,
            title: scraped.title,
            text: scraped.cleanText,
          });
        } catch (scrapeErr: any) {
          this.logger.error(`[Scrape Failed] ${url}: ${scrapeErr.message}`);
        }
      }
    }

    const queryForSearch = (articleTitle || userInstruction || '').trim();
    const cleanedSearchQuery = queryForSearch
      .replace(/https?:\/\/[^\s]+/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

    if (cleanedSearchQuery.length > 5) {
      try {
        const searchResults = await this.webSearchService.searchReputableWeb(
          cleanedSearchQuery,
          5,
        );
        if (searchResults && searchResults.length > 0) {
          searchResults.forEach((res, i) => {
            scrapedUrls.push({
              url: res.link,
              title: res.title,
              text: res.scrapedText
                ? `=== REFERENSI BENCHMARK ${i + 1}: ${res.title} ===\nTautan: ${res.link}\nKonten:\n${res.scrapedText}`
                : `=== REFERENSI BENCHMARK ${i + 1}: ${res.title} ===\nTautan: ${res.link}\nRingkasan: ${res.snippet}`,
            });
          });
        }
      } catch (searchErr: any) {
        this.logger.error(`[Proactive Search Failed]: ${searchErr.message}`);
      }
    }

    const sourceDocs: any[] = [];
    for (const docId of validDocIds) {
      const doc = await this.documentRepository.findById(docId);
      if (doc) sourceDocs.push(doc);
    }

    let manifestPromptSection = '';
    if (synthesizedManifest) {
      const argumenList = Array.isArray(synthesizedManifest.argumenKunci)
        ? synthesizedManifest.argumenKunci
          .map(
            (arg, idx) =>
              `- Argumen ${idx + 1}: "${arg.fakta}" (Sitasi wajib: ${arg.sitasiAsli || 'Rujukan internal'})`,
          )
          .join('\n')
        : 'Tidak ada argumen spesifik.';

      manifestPromptSection = `
=== MATRIKS HASIL DISKUSI SEBELUMNYA (KONSENSUS DASAR) ===
Kembangkan naskah mengikuti kerangka argumen yang disepakati:
- Tesis Utama: "${synthesizedManifest.tesisUtama}"
- Pokok Argumen:
${argumenList}
`;
    }

    const promptUserInstruction = userInstruction
      ? `Instruksi Khusus Pengguna: ${userInstruction}`
      : 'Susun naskah kebijakan yang komprehensif, berbasis data, dan solutif.';

    const isLongLength = String(targetLength).toUpperCase() === 'LONG';
    const isShortLength = String(targetLength).toUpperCase() === 'SHORT';
    const normalizedLengthKey = isLongLength ? 'LONG' : isShortLength ? 'SHORT' : 'MEDIUM';

    // Alokasi token output sesuai target length (terpisah dari budget chart)
    const articleMaxTokens = this.TOKEN_BUDGET_BY_LENGTH[normalizedLengthKey];

    // Panduan panjang yang TEGAS: bukan estimasi (~) tapi MINIMUM ABSOLUT
    const lengthRequirementText = isLongLength
      ? 'TARGET PANJANG NASKAH — MINIMUM ABSOLUT: 3.000 KATA (BOLEH HINGGA 4.500 KATA). ' +
        'Susun dalam 5–7 Bab utama (##). Setiap bab/bagian WAJIB memiliki MINIMAL 450 KATA (akumulasi narasi, tabel data, dan poin rekomendasi). ' +
        'DILARANG KERAS membuat naskah pendek, memecah teks menjadi belasan sub-heading kecil satu kalimat, atau berhenti sebelum target kata tercapai. ' +
        'Jika mendekati akhir bab terakhir dan kata masih kurang dari 3.000, TAMBAH paragraf analisis, implikasi, atau rekomendasi. ' +
        'WAJIB menulis sampai selesai — pastikan kalimat dan paragraf terakhir tuntas penuh, tidak terpotong.'
      : isShortLength
        ? 'TARGET PANJANG NASKAH — MINIMUM ABSOLUT: 750 KATA (BOLEH HINGGA 1.000 KATA). ' +
          'Susun dalam 3–4 Bab utama (##). Setiap bagian WAJIB memiliki MINIMAL 150 KATA (kombinasi narasi, poin, atau tabel). ' +
          'WAJIB menulis sampai selesai — pastikan kalimat dan paragraf terakhir tuntas penuh, tidak terpotong.'
        : 'TARGET PANJANG NASKAH — MINIMUM ABSOLUT: 1.500 KATA (BOLEH HINGGA 2.000 KATA). ' +
          'Susun dalam 4–5 Bab utama (##). Setiap bagian WAJIB memiliki MINIMAL 300 KATA yang kaya format (tabel, poin, grafik, narasi). ' +
          'WAJIB menulis sampai selesai — pastikan kalimat dan paragraf terakhir tuntas penuh, tidak terpotong.';

    const userQuery = `
[JUDUL DOKUMEN TARGET]: "${normalizedTitle}"
${lengthRequirementText}
${promptUserInstruction}
${manifestPromptSection}

INSTRUKSI KREASI BEBAS:
Rancang dan tulis naskah ini dengan kebebasan penuh. Gunakan keahlian analitis Anda untuk menentukan struktur bab yang mengalir alami.
Jangan sisipkan gambar chart di dalam teks — cukup tulis narasi dan data numeriknya.
Setelah selesai, isi field chartHints dengan topik chart yang relevan (jika ada) untuk disisipkan nanti.
`.trim();

    const promptPayload = await this.contextAssembly.assemblePromptPayload({
      documentIds: validDocIds,
      userQuery,
      tone,
      targetLength: targetLength as string,
      scrapedUrls,
    });

    this.tokenEstimator.enforceBudgetCircuitBreaker({
      texts: promptPayload.messages.map((m) => m.content || ''),
      imagesCount: 0,
      maxBudgetTokens: this.MAX_DRAFTING_TOKEN_BUDGET,
    });

    const userPromptRecordedContent = `[JUDUL DOKUMEN]: ${normalizedTitle}\n[TONE]: ${tone}\n[TARGET PANJANG]: ${targetLength}\n${userInstruction || ''}`;
    await this.chatRepository.addMessage({
      sessionId: session.id,
      role: MessageRole.USER,
      content: userPromptRecordedContent,
      tokenCount: this.tokenEstimator.estimateTokenCount(userPromptRecordedContent),
      metadata: scrapedUrls.length > 0 ? { scrapedUrls } : undefined,
    });

    let fullArticleText = '';
    const temporal = this.contextAssembly.generateTemporalGroundTruth();

    try {
      // ================================================================
      // LANGKAH 1: RANCANG OUTLINE BAB STRATEGIS (AI OUTLINE CALL)
      // ================================================================
      this.logger.log(`[ArticleGen] Merancang arsitektur naskah (Outline Bab) untuk target: ${normalizedLengthKey}...`);

      let outlineResult: OutlineResult | null = null;
      try {
        outlineResult = await this.llmAdapter.generateStructuredAnalysis<OutlineResult>(
          [
            ...promptPayload.messages,
            {
              role: 'user',
              content: `Rancang Outline Bab Strategis untuk naskah: "${normalizedTitle}".\n${lengthRequirementText}\nPastikan daftarBab memiliki bab-bab utama yang komprehensif dengan alokasi target kata spesifik agar total seluruh bab mencapai target panjang yang diminta secara tuntas.`,
            },
          ],
          OUTLINE_OUTPUT_SCHEMA,
          0.6,
          4096,
        );
      } catch (outlineErr: any) {
        this.logger.warn(`[ArticleGen Outline Fallback] Menggunakan blueprint bab default: ${outlineErr.message}`);
      }

      if (outlineResult?.judulUsulan && outlineResult.judulUsulan.trim().length > 0) {
        normalizedTitle = outlineResult.judulUsulan.trim().replace(/^#+\s*/, '');
      }

      // Ambil daftar bab dari AI Outline atau blueprint default
      const defaultChapters = this.getDefaultChapters(normalizedLengthKey, normalizedTitle);
      let targetChapters: OutlineChapter[] = defaultChapters;

      if (
        outlineResult?.daftarBab &&
        Array.isArray(outlineResult.daftarBab) &&
        outlineResult.daftarBab.length >= defaultChapters.length
      ) {
        targetChapters = outlineResult.daftarBab;
      }

      const totalTargetWords = targetChapters.reduce((sum, ch) => sum + (ch.targetKata || 400), 0);
      this.logger.log(
        `[ArticleGen] Memulai penulisan paralel untuk ${targetChapters.length} bab (Target akumulasi: ~${totalTargetWords} kata)...`,
      );

      // Ekstrak konteks dokumen acuan ringkas untuk bab
      const referenceSummary = promptPayload.messages
        .filter((m) => m.role === 'system' || m.role === 'user')
        .map((m) => m.content || '')
        .join('\n')
        .substring(0, 4000);

      // ================================================================
      // LANGKAH 2: PENULISAN BAB PER BAB SECARA PARALEL (SECTION-BY-SECTION)
      // ================================================================
      const chapterPromises = targetChapters.map((ch) =>
        this.generateSingleChapter(ch, normalizedTitle, tone, referenceSummary),
      );

      const generatedChapters = await Promise.all(chapterPromises);

      // Gabungkan seluruh bab
      const rawCombinedBody = generatedChapters.join('\n\n');
      fullArticleText = ensureDocumentTitleHeader(rawCombinedBody, normalizedTitle);

      // ================================================================
      // LANGKAH 3: PEMISAHAN TOTAL TOKEN CHART (LLM CALL TERPISAH)
      // ================================================================
      const chartHints = (outlineResult?.chartHints || '').trim();
      if (chartHints.length > 10) {
        try {
          this.logger.log(
            `[ArticleGen] Generate chart terpisah (token independen): "${chartHints.substring(0, 80)}..."`,
          );
          const chartResult = await this.llmAdapter.generateStructuredAnalysis<any>(
            [
              {
                role: 'system',
                content:
                  'Anda adalah spesialis visualisasi data. Hasilkan chart QuickChart URL yang akurat, proporsional, dan rapi.',
              },
              {
                role: 'user',
                content: `Topik naskah: "${normalizedTitle}"\n\nBuat chart QuickChart Markdown untuk topik berikut:\n${chartHints}\n\nGunakan data numerik estimasi realistis yang relevan. Format output: gambar Markdown QuickChart (![judul](url)).`,
              },
            ],
            CHART_GENERATION_SCHEMA,
            0.5,
            this.CHART_TOKEN_BUDGET,
          );

          const chartMarkdown = (chartResult?.charts || '').trim();
          if (chartMarkdown.length > 20) {
            // Sisipkan chart setelah Bab III (Kondisi Faktual / Data Empiris) jika ada, atau setelah Bab I
            const dataChapterMatch =
              fullArticleText.match(/\n## III\.[^\n]+/i) ||
              fullArticleText.match(/\n## II\.[^\n]+/i) ||
              fullArticleText.match(/\n## [IVX0-9]+[.\s]/);

            if (dataChapterMatch) {
              const insertIdx =
                fullArticleText.indexOf(dataChapterMatch[0]) + dataChapterMatch[0].length;
              const afterChapter = fullArticleText.substring(insertIdx);
              const nextParaEnd = afterChapter.indexOf('\n\n');
              if (nextParaEnd >= 0) {
                const absInsertIdx = insertIdx + nextParaEnd + 2;
                fullArticleText =
                  fullArticleText.substring(0, absInsertIdx) +
                  '\n' +
                  chartMarkdown +
                  '\n\n' +
                  fullArticleText.substring(absInsertIdx);
              } else {
                fullArticleText += '\n\n' + chartMarkdown;
              }
            } else {
              fullArticleText += '\n\n' + chartMarkdown;
            }
            fullArticleText = sanitizeQuickChartMarkdown(fullArticleText);
          }
        } catch (chartErr: any) {
          this.logger.warn(`[ArticleGen] Generate chart dilewati: ${chartErr.message}`);
        }
      }

      fullArticleText = cleanArticleTitlePrefix(fullArticleText);
      fullArticleText = ensureCompleteText(fullArticleText);
      fullArticleText = ensureDocumentTitleHeader(fullArticleText, normalizedTitle);

      const actualWords = countWords(fullArticleText);
      this.logger.log(
        `[ArticleGen] SELESAI DIRAKIT! "${normalizedTitle}" berhasil menghasilkan ${actualWords} KATA NYATA (${generatedChapters.length} bab)!`,
      );
    } catch (err: any) {
      this.logger.warn(`[Article LLM Fallback] Menggunakan sintesis fallback: ${err.message}`);
      fullArticleText = createFallbackArticleText(
        normalizedTitle,
        sourceDocs,
        tone,
        targetLength as string,
        temporal,
      );
      fullArticleText = cleanArticleTitlePrefix(fullArticleText);
      fullArticleText = ensureDocumentTitleHeader(fullArticleText, normalizedTitle);
    }

    await this.chatRepository.addMessage({
      sessionId: session.id,
      role: MessageRole.ASSISTANT,
      content: fullArticleText,
      tokenCount: this.tokenEstimator.estimateTokenCount(fullArticleText),
    });

    // SINKRONISASI KUNCI: Ikat naskah baru ke activeDraft dan RESET editorDocumentState (resetEditorState = true)
    // agar ketika user berpindah ke "Sunting Manual", TipTap editor memuat naskah 3000 kata terbaru!
    await this.chatRepository.updateActiveDraft(session.id, fullArticleText, true);
    await this.chatRepository.updateArticleMetadata(session.id, normalizedTitle);

    this.logger.log(`[Article Created] Sesi '${session.id}' berhasil dinamai dengan judul resmi: "${normalizedTitle}"`);

    const updatedSession = await this.chatRepository.findSessionById(session.id);

    return {
      success: true,
      id: session.id,
      sessionId: session.id,
      articleTitle: normalizedTitle,
      tone,
      targetLength,
      fullArticleText,
      sources: sanitizeSources(updatedSession.sources),
      messages: updatedSession.messages,
    };
  }

  async updateArticleContent(
    sessionId: string,
    articleTitle?: string,
    fullArticleText?: string,
    editorDocumentState?: any,
  ): Promise<any> {
    const session = await this.chatRepository.findSessionById(sessionId);
    if (!session) {
      throw new NotFoundException(`Sesi artikel ID '${sessionId}' tidak ditemukan.`);
    }

    const trimmedTitle = (articleTitle || session.articleTitle || session.title || 'Draf Naskah Kebijakan').trim();
    const cleanTitle = trimmedTitle.replace(/^#+\s*/, '');

    let normalizedDraft = fullArticleText;
    if (normalizedDraft && typeof normalizedDraft === 'string') {
      normalizedDraft = ensureDocumentTitleHeader(normalizedDraft, cleanTitle);
    }

    if (editorDocumentState) {
      await this.chatRepository.updateEditorDocumentState(
        sessionId,
        editorDocumentState,
        cleanTitle,
        normalizedDraft || session.currentDraft || '',
      );
    } else if (normalizedDraft) {
      await this.chatRepository.updateActiveDraft(sessionId, normalizedDraft);
      await this.chatRepository.updateArticleMetadata(sessionId, cleanTitle);
    } else {
      await this.chatRepository.updateArticleMetadata(sessionId, cleanTitle);
    }

    const auditContent = 'Naskah diperbarui secara manual pada lembar kerja editor.';
    await this.chatRepository.addMessage({
      sessionId: session.id,
      role: MessageRole.SYSTEM,
      content: auditContent,
      tokenCount: this.tokenEstimator.estimateTokenCount(auditContent),
    });

    const updatedSession = await this.chatRepository.findSessionById(sessionId);

    return {
      success: true,
      id: session.id,
      sessionId: session.id,
      articleTitle: trimmedTitle,
      tone: updatedSession.tone,
      targetLength: updatedSession.targetLength,
      fullArticleText: updatedSession.currentDraft || fullArticleText || '',
      editorDocumentState: updatedSession.editorDocumentState || null,
      sources: sanitizeSources(updatedSession.sources),
      messages: updatedSession.messages,
    };
  }

  async interactWithArticleSession(
    sessionId: string,
    userInstruction: string,
  ): Promise<any> {
    const session = await this.chatRepository.findSessionById(sessionId);
    if (!session) {
      throw new NotFoundException(`Sesi artikel ID '${sessionId}' tidak ditemukan.`);
    }

    await this.chatRepository.addMessage({
      sessionId: session.id,
      role: MessageRole.USER,
      content: userInstruction,
      tokenCount: this.tokenEstimator.estimateTokenCount(userInstruction),
    });

    const conversationMessages = session.messages.map((m: any) => ({
      role: m.role === MessageRole.USER ? ('user' as const) : ('assistant' as const),
      content: m.content,
    }));

    const temporal = this.contextAssembly.generateTemporalGroundTruth();

    const targetLengthStr = String(session.targetLength || 'MEDIUM').toUpperCase();
    const lengthRule = targetLengthStr === 'LONG'
      ? 'TARGET VOLUME: Pertahankan kedalaman naskah MINIMAL 3.000 KATA PENUH dengan struktur 5–7 bab tebal (minimal 450–600 kata per bab, 3–5 paragraf per bab). DILARANG memangkas naskah menjadi ringkasan pendek!'
      : targetLengthStr === 'SHORT'
        ? 'TARGET VOLUME: Pertahankan kepadatan naskah ~750 KATA PENUH (minimal 150–250 kata per bab dalam 2–3 paragraf tebal).'
        : 'TARGET VOLUME: Pertahankan proporsi naskah ~1.500 KATA PENUH (minimal 300–400 kata per bab dalam 2–4 paragraf tebal).';

    const systemPrompt = `Anda adalah Analis Kebijakan Utama BRIDA Kabupaten Mimika.
Tugas Anda: Perbarui atau revisi naskah dokumen kebijakan berikut berdasarkan instruksi pengguna.
${lengthRule}
KEKAYAAN FORMAT: Bebas gunakan tabel Markdown, bullet/numbered lists, dan grafik QuickChart jika memperjelas data.
ATURAN KEPADATAN: Setiap bab/bagian (##) harus memiliki substansi minimal 150 kata (akumulasi narasi, tabel, dan butir analitis). Dilarang membuat heading kosong 1-2 kalimat.
Pertahankan gaya bahasa ${session.tone || 'SOLUTIF'}.
Pastikan naskah tetap utuh, terstruktur bab per bab, dan bernas.
${EDITORIAL_STYLE_GUIDE}
`;

    let revisedArticleText = '';
    const resolvedTitle = session.articleTitle || session.title || 'Draf Naskah Kebijakan';
    try {
      const llmResult = await this.llmAdapter.generateStructuredAnalysis<any>(
        [
          { role: 'system', content: systemPrompt },
          ...conversationMessages,
          { role: 'user', content: `Instruksi Revisi Pengguna: ${userInstruction}` },
        ],
        ARTICLE_OUTPUT_SCHEMA,
        0.7,
      );

      revisedArticleText = llmResult.fullText || formatArticleFromLlm(llmResult, resolvedTitle, temporal);
      revisedArticleText = cleanArticleTitlePrefix(revisedArticleText);
      revisedArticleText = ensureDocumentTitleHeader(revisedArticleText, resolvedTitle);
      revisedArticleText = sanitizeQuickChartMarkdown(revisedArticleText);
    } catch (err: any) {
      const fallbackRaw =
        `# ${resolvedTitle}\n\n[Revisi - ${new Date().toLocaleTimeString('id-ID')}]\n\n` +
        (conversationMessages[conversationMessages.length - 1]?.content || '');
      revisedArticleText = ensureDocumentTitleHeader(fallbackRaw, resolvedTitle);
    }

    await this.chatRepository.addMessage({
      sessionId: session.id,
      role: MessageRole.ASSISTANT,
      content: revisedArticleText,
      tokenCount: this.tokenEstimator.estimateTokenCount(revisedArticleText),
    });

    await this.chatRepository.updateActiveDraft(session.id, revisedArticleText);
    const updatedSession = await this.chatRepository.findSessionById(sessionId);

    return {
      success: true,
      id: session.id,
      sessionId: session.id,
      articleTitle: session.articleTitle || session.title,
      tone: session.tone,
      targetLength: session.targetLength,
      fullArticleText: revisedArticleText,
      sources: sanitizeSources(updatedSession.sources),
      messages: updatedSession.messages,
    };
  }

  async getAllArticleSessions(userId?: string): Promise<any[]> {
    const sessions = await this.chatRepository.findArticleSessions(userId);
    return sessions.map((s) => ({
      id: s.id,
      title: s.title,
      articleTitle: s.articleTitle || s.title,
      tone: s.tone,
      targetLength: s.targetLength,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      editorDocumentState: s.editorDocumentState || null,
      sourcesCount: s.sources?.length || 0,
      sources: sanitizeSources(s.sources),
      lastMessage: s.messages && s.messages.length > 0 ? s.messages[s.messages.length - 1].content : null,
    }));
  }

  async getArticleSessionById(sessionId: string, userId?: string): Promise<any> {
    const session = await this.chatRepository.findSessionById(sessionId, userId);
    if (!session) {
      throw new NotFoundException(`Sesi artikel ID '${sessionId}' tidak ditemukan.`);
    }

    const lastAssistantMsg = [...session.messages]
      .reverse()
      .find((m: any) => m.role === MessageRole.ASSISTANT);

    let fullArticleText = session.currentDraft || '';
    let editorDocumentState = session.editorDocumentState || null;

    if (!fullArticleText && lastAssistantMsg) {
      try {
        const parsed = JSON.parse(lastAssistantMsg.content);
        if (parsed && typeof parsed === 'object') {
          fullArticleText = parsed.updatedArticle?.draftMarkdown || parsed.fullArticleText || parsed.answer || lastAssistantMsg.content;
        } else {
          fullArticleText = lastAssistantMsg.content;
        }
      } catch {
        fullArticleText = lastAssistantMsg.content;
      }
    }

    return {
      id: session.id,
      title: session.title,
      articleTitle: session.articleTitle || session.title,
      tone: session.tone,
      targetLength: session.targetLength,
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      sources: sanitizeSources(session.sources),
      messages: session.messages,
      mediaAssets: session.mediaAssets || [],
      fullArticleText,
      editorDocumentState,
    };
  }

  async deleteArticleSession(sessionId: string): Promise<void> {
    const session = await this.chatRepository.findSessionById(sessionId);
    if (!session) {
      throw new NotFoundException(`Sesi artikel ID '${sessionId}' tidak ditemukan.`);
    }
    await this.chatRepository.deleteSession(sessionId);
  }

  /**
   * Menghasilkan daftar bab acuan (blueprint bab) per target length
   */
  private getDefaultChapters(targetLength: string, title: string): OutlineChapter[] {
    const isLong = String(targetLength).toUpperCase() === 'LONG';
    const isShort = String(targetLength).toUpperCase() === 'SHORT';

    if (isLong) {
      return [
        {
          nomorBab: 'I',
          judulBab: 'Ringkasan Eksekutif & Urgensi Kebijakan Daerah',
          targetKata: 500,
          fokusSubstansi: `Konteks strategis Kabupaten Mimika, latar belakang urgensi isu '${title}', dinamika sosial-ekonomi masyarakat, dan tujuan intervensi kebijakan.`,
          instruksiKhusus:
            'Uraikan dalam 3-4 paragraf mendalam dengan argumen berbasis data faktual dan konteks geografis Mimika.',
        },
        {
          nomorBab: 'II',
          judulBab: 'Landasan Regulasi, Kerangka Kebijakan & Otonomi Khusus',
          targetKata: 500,
          fokusSubstansi:
            'Harmonisasi UU Otonomi Khusus Papua, regulasi nasional terkait, Perda dan Perbup Mimika yang relevan, serta pemetaan celah regulasi (regulatory gap).',
          instruksiKhusus:
            'Sajikan tabel inventarisasi regulasi dan analisis perbandingan yuridis komparatif.',
        },
        {
          nomorBab: 'III',
          judulBab: 'Kondisi Faktual, Data Empiris & Analisis Spasial Antar-Distrik',
          targetKata: 600,
          fokusSubstansi:
            'Evaluasi indikator kinerja sektoral, disparitas wilayah pesisir dan pegunungan Mimika (18 distrik), data demografi OAP, dan kendala geografis lapangan.',
          instruksiKhusus:
            'Wajib sertakan tabel komparasi indikator antar distrik/sektor dan analisis akar masalah (root cause analysis) secara mendalam.',
        },
        {
          nomorBab: 'IV',
          judulBab: 'Analisis Dampak Sosial-Ekonomi & Mitigasi Risiko Kebijakan',
          targetKata: 550,
          fokusSubstansi:
            'Dampak intervensi program terhadap daya beli masyarakat, kesempatan kerja lokal, kelestarian lingkungan hidup, dan kesiapan fiskal APBD daerah.',
          instruksiKhusus:
            'Sajikan tabel analisis matriks risiko beserta strategi mitigasi terpadu per sektor.',
        },
        {
          nomorBab: 'V',
          judulBab: 'Rencana Aksi Strategis, Roadmap Implementasi & Matriks Program',
          targetKata: 550,
          fokusSubstansi:
            'Tahapan implementasi program prioritas (Quick Wins 1-3 bulan, jangka menengah 1-2 tahun), pembagian peran lintas OPD teknis, dan alokasi sumber daya.',
          instruksiKhusus:
            'Sajikan tabel roadmap implementasi program lengkap dengan OPD penanggung jawab dan indikator target capaian (KPI).',
        },
        {
          nomorBab: 'VI',
          judulBab: 'Kesimpulan Analisis Kebijakan & Rekomendasi Taktis Pimpinan',
          targetKata: 450,
          fokusSubstansi:
            'Sintesis rekomendasi kebijakan operasional yang siap diputuskan dan ditandatangani Bupati/Sekda Mimika untuk eksekusi nyata di lapangan.',
          instruksiKhusus:
            'Uraikan 5-7 butir rekomendasi taktis langsung yang berdaya eksekusi tinggi disertai mekanisme monitoring dan evaluasi berkala.',
        },
      ];
    }

    if (isShort) {
      return [
        {
          nomorBab: 'I',
          judulBab: 'Latar Belakang Masalah & Urgensi Kebijakan',
          targetKata: 250,
          fokusSubstansi: `Konteks ringkas permasalahan '${title}' di Mimika dan dasar pertimbangan kebijakan.`,
          instruksiKhusus: 'Tulis 2-3 paragraf padat berbasis data.',
        },
        {
          nomorBab: 'II',
          judulBab: 'Telaah Faktual & Analisis Akar Masalah',
          targetKata: 300,
          fokusSubstansi: 'Data empiris kondisi lapangan, perbandingan indikator, dan kendala utama.',
          instruksiKhusus: 'Sajikan tabel ringkas data dan analisis poin-poin penyebab masalah.',
        },
        {
          nomorBab: 'III',
          judulBab: 'Rekomendasi Taktis & Langkah Implementasi',
          targetKata: 250,
          fokusSubstansi: 'Solusi operasional, pembagian tugas OPD, dan target capaian terukur.',
          instruksiKhusus: 'Sajikan butir rekomendasi aksi konkret yang siap dieksekusi.',
        },
      ];
    }

    // MEDIUM (default ~1500 kata)
    return [
      {
        nomorBab: 'I',
        judulBab: 'Ringkasan Eksekutif & Latar Belakang Masalah',
        targetKata: 350,
        fokusSubstansi: `Konteks kebijakan, isu pokok '${title}', dan signifikansi bagi Kabupaten Mimika.`,
        instruksiKhusus: 'Uraikan secara komprehensif dalam 3 paragraf tebal.',
      },
      {
        nomorBab: 'II',
        judulBab: 'Landasan Regulasi & Analisis Kondisi Faktual',
        targetKata: 450,
        fokusSubstansi: 'Dasar hukum nasional dan daerah, data riil capaian indikator, dan tantangan distrik.',
        instruksiKhusus: 'Sajikan tabel komparasi data atau regulasi dan uraian analisis kritis.',
      },
      {
        nomorBab: 'III',
        judulBab: 'Analisis Dampak & Mitigasi Kendala Daerah',
        targetKata: 400,
        fokusSubstansi:
          'Dampak terhadap masyarakat lokal OAP, tantangan geografis, dan mitigasi risiko fiskal/operasional.',
        instruksiKhusus: 'Uraikan matriks evaluasi kendala dan alternatif penanganannya.',
      },
      {
        nomorBab: 'IV',
        judulBab: 'Rekomendasi Kebijakan & Rencana Tindak Lanjut',
        targetKata: 350,
        fokusSubstansi:
          'Program aksi jangka pendek dan menengah, koordinasi lintas instansi, dan indikator keberhasilan.',
        instruksiKhusus: 'Sajikan butir rekomendasi taktis bernas dan timeline tindak lanjut.',
      },
    ];
  }

  /**
   * Men-generate satu bab secara terisolasi dan mendalam (Section-by-Section)
   */
  private async generateSingleChapter(
    chapter: OutlineChapter,
    officialTitle: string,
    tone: string,
    referenceSummary: string,
  ): Promise<string> {
    const prompt = [
      `Anda adalah Analis Kebijakan Senior Badan Riset dan Inovasi Daerah (BRIDA) Kabupaten Mimika.`,
      `TUGAS ANDA: Susun naskah LENGKAP untuk bab berikut:`,
      `[JUDUL NASKAH DOKUMEN]: "${officialTitle}"`,
      `[BAB YANG HARUS DITULIS]: Bab ${chapter.nomorBab}. ${chapter.judulBab}`,
      `[TARGET VOLUME MINIMUM]: WAJIB MINIMAL ${chapter.targetKata} KATA PENUH (DILARANG KURANG DARI ${chapter.targetKata} KATA).`,
      ``,
      `[FOKUS SUBSTANSI BAB INI]:`,
      `${chapter.fokusSubstansi}`,
      ``,
      `[INSTRUKSI KHUSUS PENYAJIAN]:`,
      `${chapter.instruksiKhusus}`,
      ``,
      referenceSummary ? `[REFERENSI DOKUMEN ACUAN]:\n${referenceSummary.substring(0, 2500)}` : '',
      ``,
      `PEDOMAN PENULISAN WAJIB:`,
      `1. Awali langsung dengan heading bab Markdown: "## ${chapter.nomorBab}. ${chapter.judulBab}"`,
      `2. Tulis secara tuntas dan mendalam dengan panjang MINIMAL ${chapter.targetKata} kata.`,
      `3. KEKAYAAN FORMAT: Gunakan sub-heading (###), tabel Markdown data jika membandingkan angka atau indikator, dan butir analitis padat. DILARANG membuat paragraf ringkas 1-2 kalimat.`,
      `4. Tulis sampai SELESAI — akhiri bab ini dengan kalimat penutup bab yang tuntas, jangan memotong di tengah jalan.`,
    ]
      .filter(Boolean)
      .join('\n');

    try {
      this.logger.log(
        `[ChapterGen] Menulis Bab ${chapter.nomorBab}: "${chapter.judulBab}" (Target: ${chapter.targetKata} kata)...`,
      );
      const result = await this.llmAdapter.generateStructuredAnalysis<any>(
        [
          {
            role: 'system',
            content: `Anda adalah Analis Kebijakan Utama BRIDA Kabupaten Mimika dengan gaya penulisan ${tone.toUpperCase()}. Anda bertugas menulis satu bab naskah kebijakan secara komprehensif dan mendalam.`,
          },
          {
            role: 'user',
            content: prompt,
          },
        ],
        CHAPTER_OUTPUT_SCHEMA,
        0.65,
        4096,
      );

      let content = (result?.isiBabMarkdown || '').trim();
      if (!content || content.length < 80) {
        throw new Error(`Bab ${chapter.nomorBab} mengembalikan konten kosong atau terlalu pendek`);
      }

      // Pastikan ada heading bab yang benar
      if (!content.startsWith('## ')) {
        content = `## ${chapter.nomorBab}. ${chapter.judulBab}\n\n${content}`;
      }

      const chapterWords = countWords(content);
      this.logger.log(`[ChapterGen] Bab ${chapter.nomorBab} selesai: ${chapterWords} kata riil.`);
      return ensureCompleteText(content);
    } catch (err: any) {
      this.logger.warn(`[ChapterGen Fallback] Bab ${chapter.nomorBab} fallback: ${err.message}`);
      return createFallbackChapterText(chapter, officialTitle);
    }
  }
}

function sanitizeSources(sources: any[]): any[] {
  if (!sources) return [];
  return sources.map((s) => ({
    id: s.document?.id,
    title: s.document?.title,
    category: s.document?.metadata?.category || 'Umum',
    fileUrl: s.document?.fileUrl,
  }));
}

function formatArticleFromLlm(llmResult: any, defaultTitle: string, temporal?: any): string {
  if (llmResult.fullText) return llmResult.fullText;

  const targetPeriod = temporal ? `${temporal.currentSemester}` : 'Tahun Anggaran Berjalan';
  const resolvedTitle = llmResult.judulUsulan || defaultTitle;

  // Catatan: Baris "Disusun oleh" tidak perlu ditulis manual di sini karena 
  // akan distandarisasi secara tunggal oleh ensureDocumentTitleHeader()
  return `# ${resolvedTitle}

## I. Ringkasan Eksekutif
${llmResult.ringkasan || 'Naskah kebijakan strategis ini disusun berdasarkan hasil telaah data sektoral dan komparasi tolak ukur pembangunan daerah.'}

## II. Latar Belakang & Landasan Hukum
Pemerintah Kabupaten Mimika terus mendorong penyelarasan regulasi dan penguatan tata kelola pemerintahan yang transparan, akuntabel, dan berdaya saing tinggi.

## III. Tinjauan Analisis Kinerja & Matriks Masalah
Evaluasi capaian indikator menunjukkan perlunya penguatan kolaborasi lintas instansi dan optimalisasi sumber daya daerah guna memastikan target tercapai secara inklusif.

## IV. Rekomendasi Kebijakan & Rencana Tindak Lanjut (${targetPeriod})
1. Akselerasi koordinasi lintas Organisasi Perangkat Daerah (OPD) untuk percepatan implementasi program prioritas.
2. Penegakan monitoring dan evaluasi terpadu berbasis sistem digital berkala.
3. Optimalisasi pelibatan pemangku kepentingan masyarakat adat dan pelaku usaha daerah.
`.trim();
}

function createFallbackArticleText(
  title: string,
  docs: any[],
  tone: string,
  length: string,
  temporal?: any,
): string {
  const docNames = docs.map((d) => d.title).join(', ');
  const forwardPeriod = temporal ? `${temporal.currentSemester} / TA ${temporal.currentYear + 1}` : 'Periode Mendatang';

  return `# ${title}

*Gaya Bahasa: ${tone.toUpperCase()} | Target Panjang: ${length}*

## I. Pendahuluan & Urgensi Masalah
Dokumen acuan (${docNames || 'Data Riset Daerah'}) menjadi landasan utama dalam telaah kebijakan ini. Berdasarkan dinamika pembangunan, Pemerintah Kabupaten Mimika memprioritaskan akselerasi program berbasis bukti faktual (*evidence-based policy*).

## II. Telaah Regulasi & Analisis Komparatif
Dalam kerangka otonomi daerah dan penataan aparatur, evaluasi berkala terhadap efektivitas regulasi daerah merupakan keniscayaan guna menjawab tantangan pelayanan publik di 18 distrik.

## III. Evaluasi Dampak Sosial-Ekonomi Wilayah
Sinergi antara pemerintah daerah, badan riset, dan sektor swasta menjadi pilar fundamental dalam menjaga stabilitas makroekonomi dan pemerataan kesejahteraan masyarakat.

## IV. Rekomendasi Taktis & Roadmap Implementasi (${forwardPeriod})
1. **Langkah Cepat (Quick Wins)**: Sosialisasi intensif dan harmonisasi regulasi di tingkat dinas teknis.
2. **Penguatan Kelembagaan**: Pembentukan tim kerja terpadu untuk monitoring kepatuhan dan pelaporan berkala.
3. **Mitigasi Berkelanjutan**: Penyelarasan alokasi program prioritas dengan kebutuhan riil masyarakat.
`.trim();
}

/**
 * Normalizer Header Dokumen Idempoten (GRASP: Information Expert & Protected Variations)
 * Menjamin hanya ada tepat 1 H1 judul resmi dan tepat 1 baris atribusi instansi di puncak naskah.
 */
export function ensureDocumentTitleHeader(
  rawMarkdown: string,
  officialTitle: string,
  categoryOrOpd: string = 'Badan Riset dan Inovasi Daerah (BRIDA) Kabupaten Mimika',
): string {
  if (!rawMarkdown || !rawMarkdown.trim()) {
    return `# ${officialTitle.trim()}\n\n**Disusun oleh: ${categoryOrOpd}**\n\n`;
  }

  const cleanTitle = officialTitle
    .replace(/^#+\s*/, '')
    .replace(/^(?:Artikel\s+Strategis|Laporan\s+Strategis|Draft|Draf|Analisis\s+Strategis|Rilis\s+Pers):\s*/i, '')
    .trim();

  // 1. Bersihkan seluruh baris atribusi "Disusun oleh..." yang sudah ada di naskah
  //    (baik dalam format bold, italic, maupun plain text) untuk mencegah duplikasi
  let sanitized = rawMarkdown
    .replace(/^[ \t]*(?:\*\*|\*)?Disusun\s+oleh:?[^\n\r]*(?:\*\*|\*)?[ \t]*[\r\n]*/gim, '')
    .trim();

  // 2. Cek apakah dokumen diawali oleh heading
  const firstHeadingMatch = sanitized.match(/^#+\s+(.+)$/m);

  if (firstHeadingMatch) {
    const firstHeadingText = firstHeadingMatch[1].trim();

    // Deteksi jika heading pertama adalah nama bab (misal: "I. Ringkasan Eksekutif" atau "Pendahuluan")
    const isChapterHeading = /^(?:I\.|1\.|Bab\s+[I1]|Ringkasan\s+Eksekutif|Pendahuluan|Latar\s+Belakang)/i.test(
      firstHeadingText,
    );

    if (isChapterHeading) {
      // Pastikan bab pembuka menjadi H2 agar tidak bertabrakan dengan H1 Judul Utama
      sanitized = sanitized.replace(/^#\s+(.+)$/m, '## $1');
      return `# ${cleanTitle}\n\n**Disusun oleh: ${categoryOrOpd}**\n\n${sanitized}`;
    }

    // Jika heading pertama memang adalah judul artikel, gantikan baris tersebut dengan judul resmi terstandarisasi
    sanitized = sanitized.replace(/^#+\s+.+$/m, '').trimStart();
    return `# ${cleanTitle}\n\n**Disusun oleh: ${categoryOrOpd}**\n\n${sanitized}`;
  }

  // 3. Jika dokumen tidak memiliki heading di awal, sematkan H1 dan baris atribusi tunggal
  return `# ${cleanTitle}\n\n**Disusun oleh: ${categoryOrOpd}**\n\n${sanitized}`;
}

function cleanArticleTitlePrefix(text: string): string {
  if (!text) return '';
  return text
    .replace(/^(#\s*)(?:Artikel\s+Strategis|Laporan\s+Strategis|Draft|Draf|Analisis\s+Strategis|Rilis\s+Pers):\s*/i, '$1')
    .replace(/^(?:Artikel\s+Strategis|Laporan\s+Strategis|Draft|Draf|Analisis\s+Strategis|Rilis\s+Pers):\s*/i, '');
}

/**
 * Menghitung estimasi jumlah kata nyata dalam naskah Markdown
 */
export function countWords(text: string): number {
  if (!text || text.trim().length === 0) return 0;
  const clean = text
    .replace(/^#+\s+/gm, '')
    .replace(/[|`*_-]/g, ' ')
    .trim();
  return clean.split(/\s+/).filter(Boolean).length;
}

function createFallbackChapterText(chapter: OutlineChapter, title: string): string {
  return `## ${chapter.nomorBab}. ${chapter.judulBab}

Pemerintah Kabupaten Mimika melalui Badan Riset dan Inovasi Daerah (BRIDA) menempatkan kajian "${title}" sebagai prioritas strategis dalam akselerasi pembangunan daerah berbasis data dan bukti faktual (*evidence-based policy*). Evaluasi menyeluruh terhadap aspek ${chapter.fokusSubstansi.toLowerCase()} menunjukkan urgensi penyelarasan program kerja lintas Organisasi Perangkat Daerah (OPD).

Dalam implementasinya, kondisi geografis Kabupaten Mimika yang mencakup wilayah pesisir dan pegunungan menuntut pendekatan terpadu agar pemerataan pelayanan publik dan penguatan ekonomi kerakyatan bagi Orang Asli Papua (OAP) dapat tercapai optimal. Penguatan kelembagaan, kepatuhan regulasi, serta transparansi penganggaran menjadi pilar krusial dalam merealisasikan target kinerja daerah secara berkelanjutan.

Langkah mitigasi kendala lapangan diwujudkan melalui penguatan koordinasi teknis, peningkatan alokasi anggaran berbasis kinerja, serta pemantauan berkala guna memastikan setiap sasaran pembangunan terlaksana secara terukur, akuntabel, dan berdaya guna bagi seluruh lapisan masyarakat.`;
}

/**
 * Memastikan teks artikel tidak berakhir di tengah kalimat atau kata.
 *
 * Strategi:
 * 1. Jika teks berakhir dengan kalimat utuh (., !, ?, atau elemen Markdown yang valid) → biarkan utuh
 * 2. Jika teks terpotong di tengah kalimat tanpa tanda baca, potong ke tanda titik terakhir yang aman di ujung teks
 * 3. Jika tidak ada tanda titik di ekor, tambahkan tanda titik penutup
 */
export function ensureCompleteText(text: string): string {
  if (!text || text.trim().length === 0) return text;

  const trimmed = text.trimEnd();

  // Pola akhiran yang valid (kalimat utuh atau elemen Markdown yang menutup dengan baik)
  const validEndingPatterns = [
    /[.!?]["'»)\s]*$/,              // Kalimat berakhir dengan tanda baca
    /```\s*$/,                       // Blok kode tertutup
    /\|\s*$/,                        // Baris tabel
    /^[-*+]\s+.+$/m,                 // List item (baris terakhir adalah item list)
    /^\d+\.\s+.+$/m,                 // Numbered list item
    /^#{1,6}\s+.+$/m,                // Heading
    /\*{1,2}[^*]+\*{1,2}\s*$/,      // Bold/italic yang tertutup
  ];

  const lastLine = trimmed.split('\n').pop() || '';
  const isValidEnding = validEndingPatterns.some((pattern) => pattern.test(lastLine)) || /[.!?]["'»)\s]*$/.test(trimmed);

  if (isValidEnding) {
    return trimmed + '\n';
  }

  // Teks berakhir menggantung — cari tanda titik terakhir dalam 400 karakter terakhir
  const lastChunkStart = Math.max(0, trimmed.length - 400);
  const tail = trimmed.substring(lastChunkStart);
  const punctuationMatch = tail.match(/.*[.!?]["'»)\s]*(?=\s|$)/s);

  if (punctuationMatch && punctuationMatch[0].length > 30) {
    const safeCut = lastChunkStart + punctuationMatch[0].length;
    return trimmed.substring(0, safeCut).trimEnd() + '\n';
  }

  // Jika tidak bisa memotong dengan aman, akhiri dengan tanda titik
  return trimmed + '.\n';
}

function verifyAndCleanCitations(
  articleText: string,
  validScrapedUrls: Array<{ url: string; title: string }>,
): string {
  if (!articleText) return '';

  const validUrlMap = new Map<string, string>();
  validScrapedUrls.forEach((item) => {
    validUrlMap.set(item.url.trim(), item.title);
  });

  return articleText.replace(/\[(https?:\/\/[^\]\s]+)\]/g, (match, url) => {
    const cleanUrl = url.trim();

    if (/download\.php/i.test(cleanUrl) || /web-api\.bps\.go\.id/i.test(cleanUrl)) {
      return `[https://mimikakab.bps.go.id]`;
    }

    if (validUrlMap.has(cleanUrl)) return match;
    if (/\.(go\.id|antaranews\.com|bps\.go\.id|kompas\.com|tempo\.co|cnbcindonesia\.com|bisnis\.com|kontan\.co\.id|katadata\.co\.id)/i.test(cleanUrl)) {
      return match;
    }
    return match;
  });
}