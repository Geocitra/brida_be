import { Injectable, Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import {
  IIntentHandler,
  IntentType,
  IntentExecutionPayload,
} from '../interfaces/intent-handler.interface';
import { ChatMemoryService } from '../services/chat-memory.service';
import { ContextAssemblyService } from '../../ai-agent/services/context-assembly.service';
import {
  VendorLlmAdapter,
  MultimodalChatMessage,
} from '../../ai-agent/providers/vendor-llm.adapter';
import { PromptInjectionSanitizer } from '../utils/prompt-injection-sanitizer.util';
import { DocumentIngestionService } from '../../document-ingestion/services/document-ingestion.service';
import { ChatRepository } from '../repositories/chat.repository';
import { UrlScraperService } from '../services/url-scraper.service';
import { WebSearchService } from '../services/web-search.service';

import { EDITORIAL_STYLE_GUIDE } from '../../ai-agent/constants/system-prompts.constant';
import { ensureDocumentTitleHeader } from '../services/article-generator.service';
import { sanitizeQuickChartMarkdown } from '../utils/quickchart-sanitizer.util';

const DUAL_PANE_COOPERATIVE_SCHEMA = {
  type: 'object',
  required: ['answer'],
  properties: {
    answer: {
      type: 'string',
      description:
        'Jawaban interaktif di panel obrolan (Saluran 1). Bersifat bebas dan luwes layaknya ChatGPT! ' +
        'Jika Anda ingin menampilkan grafik, gunakan Markdown Image QuickChart. ' +
        'Jawab dengan gaya yang natural, informatif, dan mendalam tanpa terikat template baku.\n\n' +
        EDITORIAL_STYLE_GUIDE,
    },
    suggestions: {
      type: 'array',
      items: { type: 'string' },
      description: 'Tepat 3 opsi pertanyaan lanjutan atau topik eksplorasi berikutnya.',
    },
    updatedArticle: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Judul resmi dokumen naskah publikasi.',
        },
        draftMarkdown: {
          type: 'string',
          description:
            'Naskah dokumen formal utuh untuk Kanvas Cetak A4 TipTap (Saluran 2). DIBEBASKAN SEPENUHNYA menggunakan format struktur apa pun yang paling relevan. ' +
            'BEBAS BEREKSPRESI DENGAN KEKAYAAN FORMAT: Sangat dianjurkan menggunakan tabel Markdown, poin analitis (bullet/numbered lists), grafik visual QuickChart statistik numerik (Bar/Pie/Line/Doughnut Chart — DILARANG flowchart/sankey), dan narasi mengalir. ' +
            'Setiap bab utama (##) harus memiliki substansi minimal 150 kata (akumulasi teks, tabel, dan poin). ' +
            'DILARANG membuat sub-heading kecil yang hanya berisi 1-2 kalimat pendek tanpa elaborasi data. ' +
            'Eksplorasi materi seluas-luasnya sesuai target volume (SHORT: ~750 kata, MEDIUM: ~1.500 kata, LONG: MINIMAL 3.000 KATA PENUH). ' +
            'DILARANG menyisipkan referensi sitasi yang membuang kuota kata. ' +
            'KOSONGKAN properti ini jika pengguna hanya menyapa santai atau tidak meminta pembuatan naskah/dokumen.',
        },
      },
    },
  },
};

@Injectable()
export class QaIntentHandler implements IIntentHandler {
  private readonly logger = new Logger(QaIntentHandler.name);
  private readonly uploadDir = path.resolve(
    process.env.UPLOAD_DESTINATION || './uploads',
  );
  private readonly tempDir = path.join(this.uploadDir, 'temp');

  private readonly URL_REGEX = /https?:\/\/[^\s]+/gi;

  constructor(
    private readonly sanitizer: PromptInjectionSanitizer,
    private readonly chatMemory: ChatMemoryService,
    private readonly contextAssembly: ContextAssemblyService,
    private readonly llmAdapter: VendorLlmAdapter,
    private readonly ingestionService: DocumentIngestionService,
    private readonly chatRepository: ChatRepository,
    private readonly urlScraperService: UrlScraperService,
    private readonly webSearchService: WebSearchService,
  ) { }

  getIntentType(): IntentType {
    return 'ANALYTICAL_QA';
  }

  canHandle(query: string): boolean {
    return true;
  }

  async execute(payload: IntentExecutionPayload): Promise<any> {
    this.logger.log(
      `[QaIntentHandler] Memproses kueri adaptif untuk Sesi ID: ${payload.sessionId}...`,
    );

    const sanitizedQuery = this.sanitizer.sanitize(payload.query);

    const foundUrls = sanitizedQuery.match(this.URL_REGEX) || [];
    const currentScrapedUrls: Array<{ url: string; title: string; text: string }> =
      [];

    if (foundUrls.length > 0) {
      this.logger.log(
        `[URL Interceptor] Mendeteksi ${foundUrls.length} tautan eksternal untuk diekstraksi.`,
      );
      const scrapeTasks = foundUrls.map(async (url: string) => {
        try {
          const scraped = await this.urlScraperService.scrapeAndExtract(url);
          return {
            url: scraped.sourceUrl,
            title: scraped.title,
            text: scraped.cleanText,
          };
        } catch (scrapeErr: any) {
          this.logger.error(
            `[Parallel Scrape Failed] Gagal memproses URL ${url}: ${scrapeErr.message}`,
          );
          return null;
        }
      });

      const scrapeResults = await Promise.all(scrapeTasks);
      for (const res of scrapeResults) {
        if (res) {
          currentScrapedUrls.push(res);
        }
      }
    }

    await this.chatMemory.recordUserMessage(
      payload.sessionId,
      sanitizedQuery,
      currentScrapedUrls.length > 0
        ? { scrapedUrls: currentScrapedUrls }
        : undefined,
    );

    const memory = await this.chatMemory.getActiveSlidingWindowMemory(
      payload.sessionId,
    );

    const documentIds = [...(memory.documentIds || [])];
    const images: Array<{ mimeType: string; base64Data: string }> = [];

    if (payload.attachments && payload.attachments.length > 0) {
      for (const att of payload.attachments) {
        if (att.classification) {
          try {
            this.logger.log(
              `[Bypass Ingest] Menjalankan pendaftaran dokumen untuk berkas sementara: ${att.fileId}`,
            );

            const categoryMap = {
              BASELINE: 'Perencanaan & Baseline Target',
              REALIZATION: 'Laporan Realisasi Capaian',
              GENERAL_REFERENCE: 'Referensi Umum & Kliping',
            } as const;

            const classificationKey =
              att.classification as keyof typeof categoryMap;
            const targetCategory =
              categoryMap[classificationKey] || 'Referensi Umum & Kliping';

            const ingestedDoc =
              await this.ingestionService.convertTempToPermanent(att.fileId, {
                title: `Dokumen Tambahan Chat (${att.classification})`,
                category: targetCategory,
                docType: att.classification,
              });

            documentIds.push(ingestedDoc.id);

            await this.chatRepository.linkDocumentSource(
              payload.sessionId,
              ingestedDoc.id,
            );
          } catch (ingestErr: any) {
            this.logger.error(
              `[Bypass Ingest Failed] Gagal mendaftarkan dokumen sementara: ${ingestErr.message}`,
            );
          }
        } else {
          try {
            const files = fs.readdirSync(this.tempDir);
            const targetFile = files.find((f) => f.startsWith(att.fileId));

            if (targetFile) {
              const filePath = path.join(this.tempDir, targetFile);
              const fileBuffer = fs.readFileSync(filePath);

              const parts = targetFile.split('__');
              const mimeType =
                parts.length > 1
                  ? Buffer.from(parts[1], 'hex').toString('utf-8')
                  : 'image/png';

              images.push({
                mimeType,
                base64Data: fileBuffer.toString('base64'),
              });
            }
          } catch (imageErr: any) {
            this.logger.error(
              `[Screenshot Resolution Failed] Gagal memuat data biner gambar: ${imageErr.message}`,
            );
          }
        }
      }
    }

    const proactiveScrapedUrls: Array<{
      url: string;
      title: string;
      text: string;
    }> = [];
    let isProactiveSearch = false;

    // Filter agar kueri sapaan/tes tidak memicu pencarian web yang tidak perlu
    const isAnalyticalQuery =
      sanitizedQuery.length > 8 &&
      !/^(halo|hi|hai|pagi|siang|sore|malam|terima kasih|thanks|p|tes|test|oke|siap)$/i.test(
        sanitizedQuery.trim(),
      );

    if (isAnalyticalQuery) {
      try {
        this.logger.log(
          `[Proactive Search] Kueri analitis terdeteksi. Menjalankan penelusuran benchmark eksternal...`,
        );
        const searchResults = await this.webSearchService.searchReputableWeb(
          sanitizedQuery,
          5,
        );

        if (searchResults && searchResults.length > 0) {
          isProactiveSearch = true;
          searchResults.forEach((res, i) => {
            proactiveScrapedUrls.push({
              url: res.link,
              title: res.title,
              text: res.scrapedText
                ? `=== REFERENSI BENCHMARK ${i + 1}: ${res.title} ===\nTautan: ${res.link}\nKonten Halaman:\n${res.scrapedText}`
                : `=== REFERENSI BENCHMARK ${i + 1}: ${res.title} ===\nTautan: ${res.link}\nRingkasan Fakta: ${res.snippet}`,
            });
          });
          this.logger.log(
            `[Proactive Search] Berhasil mengintegrasikan ${searchResults.length} sumber referensi eksternal.`,
          );
        }
      } catch (searchErr: any) {
        this.logger.error(
          `[Proactive Search Failed] Gagal mengayakan konteks eksternal: ${searchErr.message}`,
        );
      }
    }

    const scrapedUrlsFromHistory: Array<{
      url: string;
      title: string;
      text: string;
    }> = [];
    const historyMessages: MultimodalChatMessage[] = memory.activeMessages.map(
      (m) => {
        const meta = m.metadata as any;
        if (meta && Array.isArray(meta.scrapedUrls)) {
          scrapedUrlsFromHistory.push(...meta.scrapedUrls);
        }
        return {
          role: m.role === 'USER' ? 'user' : 'assistant',
          content: m.content,
        };
      },
    );

    const allScrapedUrls = [
      ...scrapedUrlsFromHistory,
      ...currentScrapedUrls,
      ...proactiveScrapedUrls,
    ];

    const promptPayload = await this.contextAssembly.assemblePromptPayload({
      documentIds,
      images,
      userQuery: sanitizedQuery,
      currentDraft: payload.currentDraft,
      tone: memory.tone || 'solutif',
      targetLength: memory.targetLength || 'MEDIUM',
      districts: payload.districts,
      scrapedUrls: allScrapedUrls,
    });

    promptPayload.messages.splice(2, 0, ...historyMessages);
    if (memory.runningSummary) {
      promptPayload.messages.splice(1, 0, {
        role: 'system',
        content: `[RINGKASAN EPISODIK OBROLAN SEBELUMNYA]\nBerikut adalah ringkasan jalannya obrolan sebelumnya: ${memory.runningSummary}`,
      });
    }

    const analysisResult =
      await this.llmAdapter.generateStructuredAnalysis<any>(
        promptPayload.messages,
        DUAL_PANE_COOPERATIVE_SCHEMA,
        0.5,
      );

    if (analysisResult.answer) {
      analysisResult.answer = cleanCitationsText(
        analysisResult.answer,
        allScrapedUrls,
      );
      analysisResult.answer = sanitizeQuickChartMarkdown(analysisResult.answer);
    }
    if (
      analysisResult.updatedArticle &&
      analysisResult.updatedArticle.draftMarkdown
    ) {
      analysisResult.updatedArticle.draftMarkdown = cleanCitationsText(
        analysisResult.updatedArticle.draftMarkdown,
        allScrapedUrls,
      );
      analysisResult.updatedArticle.draftMarkdown = sanitizeQuickChartMarkdown(
        analysisResult.updatedArticle.draftMarkdown,
      );
    }

    // Guardrail: Pastikan draf tidak terisi sembarangan jika pengguna hanya mengobrol kasual
    if (
      analysisResult.updatedArticle &&
      analysisResult.updatedArticle.draftMarkdown
    ) {
      const draft = analysisResult.updatedArticle.draftMarkdown.trim();
      const answer = (analysisResult.answer || '').trim();

      const isIdenticalToAnswer = draft === answer;
      const isRefusalKeyword =
        draft.includes('tidak ditemukan di dalam dokumen') ||
        draft.includes('belum bisa ditulis') ||
        draft.includes('belum menemukan isi artikel') ||
        draft.includes('tidak memiliki akses');
      const isShortNonArticle = !draft.startsWith('#') && draft.length < 250;

      if (isIdenticalToAnswer || isRefusalKeyword || isShortNonArticle) {
        delete analysisResult.updatedArticle;
      }
    }

    if (
      analysisResult.updatedArticle &&
      analysisResult.updatedArticle.draftMarkdown
    ) {
      const updatedTitle =
        analysisResult.updatedArticle.title ||
        memory.articleTitle ||
        memory.title ||
        'Draf Kebijakan Publikasi';

      // Pastikan draftMarkdown yang dikirim ke panel kanan diawali dengan Judul Resmi
      analysisResult.updatedArticle.draftMarkdown = ensureDocumentTitleHeader(
        analysisResult.updatedArticle.draftMarkdown,
        updatedTitle,
      );

      await this.chatRepository.updateActiveDraft(
        payload.sessionId,
        analysisResult.updatedArticle.draftMarkdown,
      );
      await this.chatRepository.updateArticleMetadata(
        payload.sessionId,
        updatedTitle,
      );

      this.logger.log(
        `[State Sync] Draf naskah A4 berhasil disinkronkan ke PostgreSQL dengan H1 Judul Resmi.`,
      );
    }

    const assistantResponseContent = JSON.stringify(analysisResult);
    await this.chatMemory.recordAssistantMessage(
      payload.sessionId,
      assistantResponseContent,
      isProactiveSearch && proactiveScrapedUrls.length > 0
        ? { scrapedUrls: proactiveScrapedUrls }
        : undefined,
    );

    if (
      this.chatMemory.shouldTriggerCompaction(
        memory.prunedMessagesCount,
        memory.totalMemoryTokens,
      )
    ) {
      this.triggerBackgroundCompaction(
        payload.sessionId,
        memory,
        analysisResult.answer,
      );
    }

    return {
      intent: this.getIntentType(),
      sessionId: payload.sessionId,
      documentIds,
      data: analysisResult,
      memoryInfo: {
        activeTokens: memory.totalMemoryTokens,
        prunedMessagesCount: memory.prunedMessagesCount,
      },
    };
  }

  private async triggerBackgroundCompaction(
    sessionId: string,
    memory: any,
    latestAnswer: string,
  ): Promise<void> {
    const previousSummary =
      memory.runningSummary || 'Belum ada riwayat pembicaraan.';
    const activeMessagesStr = memory.activeMessages
      .map(
        (m: any) =>
          `${m.role === 'USER' ? 'User' : 'Assistant'}: ${m.content}`,
      )
      .join('\n');

    const compactionPrompt: MultimodalChatMessage[] = [
      {
        role: 'system',
        content: `Anda adalah asisten pencatat memori kognitif BRIDA Mimika.
Tugas Anda: Perbarui [RINGKASAN EPISODIK OBROLAN] secara padat dan kronologis (maksimal 200 kata).
Gabungkan ringkasan sebelumnya dengan obrolan baru tanpa pengantar apa pun.
WAJIB patuhi gaya bahasa berikut saat meringkas:\n${EDITORIAL_STYLE_GUIDE}`,
      },
      {
        role: 'user',
        content: `RINGKASAN SEBELUMNYA:\n${previousSummary}\n\nOBROLAN BARU:\n${activeMessagesStr}\nAssistant: ${latestAnswer}`,
      },
    ];

    const compactionSchema = {
      type: 'object',
      required: ['summary'],
      properties: {
        summary: {
          type: 'string',
          description: 'Ringkasan naratif gabungan baru.',
        },
      },
    };

    setImmediate(async () => {
      try {
        const result =
          await this.llmAdapter.generateStructuredAnalysis<{
            summary: string;
          }>(compactionPrompt, compactionSchema, 0.0);

        if (result && result.summary) {
          await this.chatMemory.updateRunningSummary(
            sessionId,
            result.summary,
          );
          this.logger.log(
            `[Compaction Guard] Berhasil memperbarui Running Summary.`,
          );
        }
      } catch (err: any) {
        this.logger.error(
          `[Compaction Guard Error] Gagal memadatkan memori: ${err.message}`,
        );
      }
    });
  }
}

function cleanCitationsText(
  text: string,
  validScrapedUrls: Array<{ url: string; title: string }>,
): string {
  if (!text) return '';

  const validUrlMap = new Map<string, string>();
  validScrapedUrls.forEach((item) => {
    validUrlMap.set(item.url.trim(), item.title);
  });

  return text.replace(/\[(https?:\/\/[^\]\s]+)\]/g, (match, url) => {
    const cleanUrl = url.trim();

    if (
      /download\.php/i.test(cleanUrl) ||
      /web-api\.bps\.go\.id/i.test(cleanUrl)
    ) {
      return `[https://mimikakab.bps.go.id]`;
    }

    if (validUrlMap.has(cleanUrl)) {
      return match;
    }

    if (
      /\.(go\.id|antaranews\.com|bps\.go\.id|kompas\.com|tempo\.co|cnbcindonesia\.com|bisnis\.com|kontan\.co\.id|katadata\.co\.id)/i.test(
        cleanUrl,
      )
    ) {
      return match;
    }

    return match;
  });
}