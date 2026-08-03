import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import {
  IIntentHandler,
  IntentType,
  IntentExecutionPayload,
} from '../interfaces/intent-handler.interface';
import { ChatMemoryService } from '../services/chat-memory.service';
import { ContextAssemblyService } from '../../ai-agent/services/context-assembly.service';
import { VendorLlmAdapter, MultimodalChatMessage } from '../../ai-agent/providers/vendor-llm.adapter';
import { PromptInjectionSanitizer } from '../utils/prompt-injection-sanitizer.util';
import { DocumentIngestionService } from '../../document-ingestion/services/document-ingestion.service';
import { ChatRepository } from '../repositories/chat.repository';
import { UrlScraperService } from '../services/url-scraper.service';
import { WebSearchService } from '../services/web-search.service';

// --- Impor Style Guide Global ---
import { EDITORIAL_STYLE_GUIDE } from '../../ai-agent/constants/system-prompts.constant';

// Skema Respons Obrolan Kolaboratif Dual-Pane
const DUAL_PANE_COOPERATIVE_SCHEMA = {
  type: 'object',
  required: ['answer'],
  properties: {
    answer: {
      type: 'string',
      description:
        `The conversational feedback/thought process in Bahasa Indonesia explaining what changes you made, what data you analyzed, or answering the user. Format strictly using beautiful, rich Markdown (using headers ##, bold texts, bullet lists, and comparison tables if comparing data). Always embed structured citation anchors in the format [docId:chunkIndex] (e.g. [doc-001:2]) adjacent to any claims, metrics, or factual statements derived from the context chunks. WAJIB patuhi panduan berikut:\n\n${EDITORIAL_STYLE_GUIDE}`,
    },
    suggestions: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Generate exactly 3 highly relevant, contextual follow-up questions or discussion options to guide the user in continuing the conversation.',
    },
    updatedArticle: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'The updated or newly generated article title. DILARANG menggunakan prefix "Artikel Strategis:" atau semacamnya.',
        },
        draftMarkdown: {
          type: 'string',
          description: `The fully updated or newly generated article text formatted in Markdown. If the user only asked a question without editing or creating the article, return the unmodified currentDraft or leave this blank. JIKA MENGHASILKAN TEKS BARU, WAJIB PATUHI:\n\n${EDITORIAL_STYLE_GUIDE}`,
        },
      },
    },
  },
};

@Injectable()
export class QaIntentHandler implements IIntentHandler {
  private readonly logger = new Logger(QaIntentHandler.name);
  private readonly uploadDir = path.resolve(process.env.UPLOAD_DESTINATION || './uploads');
  private readonly tempDir = path.join(this.uploadDir, 'temp');

  // Pola Regular Expression untuk menangkap URL HTTP/HTTPS secara aman
  private readonly URL_REGEX = /https?:\/\/[^\s]+/gi;

  constructor(
    private readonly sanitizer: PromptInjectionSanitizer,
    private readonly chatMemory: ChatMemoryService,
    private readonly contextAssembly: ContextAssemblyService,
    private readonly llmAdapter: VendorLlmAdapter,
    private readonly ingestionService: DocumentIngestionService,
    private readonly chatRepository: ChatRepository,
    private readonly urlScraperService: UrlScraperService, // Injeksi Web Scraper
    private readonly webSearchService: WebSearchService,   // Injeksi Web Searcher
  ) { }

  getIntentType(): IntentType {
    return 'ANALYTICAL_QA';
  }

  canHandle(query: string): boolean {
    return true; // Fallback utama obrolan umum & kolaborasi penulisan
  }

  async execute(payload: IntentExecutionPayload): Promise<any> {
    this.logger.log(
      `[QaIntentHandler] Memproses kolaborasi tanya-jawab untuk Sesi ID: ${payload.sessionId}...`,
    );

    // 1. Sanitasi prompt dari pola serangan Prompt Injection
    const sanitizedQuery = this.sanitizer.sanitize(payload.query);

    // Scraping URL proaktif jika ada tautan dalam query pengguna
    const foundUrls = sanitizedQuery.match(this.URL_REGEX) || [];
    const currentScrapedUrls: Array<{ url: string; title: string; text: string }> = [];

    if (foundUrls.length > 0) {
      this.logger.log(`[URL Interceptor] Mendeteksi ${foundUrls.length} tautan eksternal untuk diekstraksi.`);
      const scrapeTasks = foundUrls.map(async (url: string) => {
        try {
          const scraped = await this.urlScraperService.scrapeAndExtract(url);
          return {
            url: scraped.sourceUrl,
            title: scraped.title,
            text: scraped.cleanText,
          };
        } catch (scrapeErr: any) {
          this.logger.error(`[Parallel Scrape Failed] Gagal memproses URL ${url}: ${scrapeErr.message}`);
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

    // 2. Rekam pesan pengguna ke dalam database obrolan (dengan metadata scrapedUrls jika ada)
    await this.chatMemory.recordUserMessage(payload.sessionId, sanitizedQuery, currentScrapedUrls.length > 0 ? { scrapedUrls: currentScrapedUrls } : undefined);

    // 3. Ambil sliding window memory sesi aktif
    const memory = await this.chatMemory.getActiveSlidingWindowMemory(payload.sessionId);

    // 4. Resolusi Lampiran Berkas (Bypass Ingest untuk PDF/DOCX & Base64 untuk Screenshots)
    const documentIds = [...(memory.documentIds || [])];
    const images: Array<{ mimeType: string; base64Data: string }> = [];

    if (payload.attachments && payload.attachments.length > 0) {
      for (const att of payload.attachments) {
        if (att.classification) {
          // Kasus A: Lampiran dokumen kebijakan (Jalankan Ingestion Bypass)
          try {
            this.logger.log(`[Bypass Ingest] Menjalankan bypass pendaftaran dokumen untuk ID berkas sementara: ${att.fileId}`);

            const categoryMap = {
              BASELINE: 'Perencanaan & Baseline Target',
              REALIZATION: 'Laporan Realisasi Capaian',
              GENERAL_REFERENCE: 'Referensi Umum & Kliping',
            } as const;

            const classificationKey = att.classification as keyof typeof categoryMap;
            const targetCategory = categoryMap[classificationKey] || 'Referensi Umum & Kliping';

            const ingestedDoc = await this.ingestionService.convertTempToPermanent(att.fileId, {
              title: `Dokumen Tambahan Chat (${att.classification})`,
              category: targetCategory,
              docType: att.classification,
            });

            documentIds.push(ingestedDoc.id);

            // Tautkan dokumen baru ini ke sesi obrolan aktif secara dinamis
            await this.chatRepository.linkDocumentSource(payload.sessionId, ingestedDoc.id);
          } catch (ingestErr: any) {
            this.logger.error(`[Bypass Ingest Failed] Gagal mendaftarkan dokumen sementara ke repositori: ${ingestErr.message}`);
          }
        } else {
          // Kasus B: Lampiran gambar screenshot dari clipboard (Ctrl+V)
          try {
            const files = fs.readdirSync(this.tempDir);
            const targetFile = files.find((f) => f.startsWith(att.fileId));

            if (targetFile) {
              const filePath = path.join(this.tempDir, targetFile);
              const fileBuffer = fs.readFileSync(filePath);

              const parts = targetFile.split('__');
              const mimeType = parts.length > 1
                ? Buffer.from(parts[1], 'hex').toString('utf-8')
                : 'image/png';

              images.push({
                mimeType,
                base64Data: fileBuffer.toString('base64'),
              });
            }
          } catch (imageErr: any) {
            this.logger.error(`[Screenshot Resolution Failed] Gagal memuat data biner gambar: ${imageErr.message}`);
          }
        }
      }
    }

    // 5. PENANGANAN PROAKTIF EKSTERNAL (Web Scraping & Search) [1.1.2]
    const proactiveScrapedUrls: Array<{ url: string; title: string; text: string }> = [];
    let isProactiveSearch = false;

      // Skenario B: Pencarian Proaktif (AI mencari suplemen kontekstual secara proaktif)
      const isAnalyticalQuery = sanitizedQuery.length > 12 &&
        !/^(halo|hi|hai|pagi|siang|sore|malam|terima kasih|thanks|p|tes|test)/i.test(sanitizedQuery);

      if (isAnalyticalQuery) {
        try {
          this.logger.log(`[Proactive Search] Kueri analitis terdeteksi. Melakukan pengayaan eksternal secara proaktif...`);
          const searchResults = await this.webSearchService.searchReputableWeb(sanitizedQuery, 2);

          if (searchResults && searchResults.length > 0) {
            isProactiveSearch = true;
            searchResults.forEach((res, i) => {
              proactiveScrapedUrls.push({
                url: res.link,
                title: res.title,
                text: `=== ARTIKEL LUAR ${i + 1}: ${res.title} ===\nTautan: ${res.link}\nRingkasan Fakta: ${res.snippet}`,
              });
            });
            this.logger.log(`[Proactive Search] Konteks eksternal tervalidasi berhasil diintegrasikan secara transien.`);
          }
        } catch (searchErr: any) {
          this.logger.error(`[Proactive Search Failed] Gagal mengayakan konteks eksternal: ${searchErr.message}`);
        }
      }

    // Format riwayat obrolan jangka pendek untuk prompt, dan kumpulkan scrapedUrls yang ada di metadata
    const scrapedUrlsFromHistory: Array<{ url: string; title: string; text: string }> = [];
    const historyMessages: MultimodalChatMessage[] = memory.activeMessages.map((m) => {
      const meta = m.metadata as any;
      if (meta && Array.isArray(meta.scrapedUrls)) {
        scrapedUrlsFromHistory.push(...meta.scrapedUrls);
      }
      return {
        role: m.role === 'USER' ? 'user' : 'assistant',
        content: m.content,
      };
    });

    // Satukan seluruh scrapedUrls transien
    const allScrapedUrls = [
      ...scrapedUrlsFromHistory,
      ...currentScrapedUrls,
      ...proactiveScrapedUrls,
    ];

    // 6. Rakit Prompt Payload Multimodal Terpadu via Context Broker
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

    // Sisipkan sejarah obrolan dan ringkasan episodik jangka panjang ke dalam prompt payload
    promptPayload.messages.splice(2, 0, ...historyMessages);
    if (memory.runningSummary) {
      promptPayload.messages.splice(1, 0, {
        role: 'system',
        content: `[RINGKASAN EPISODIK OBROLAN SEBELUMNYA]\nBerikut adalah ringkasan jalannya obrolan sebelumnya untuk memicu ingatan jangka panjang Anda: ${memory.runningSummary}`,
      });
    }

    // 7. Eksekusi Model LLM Multimodal terpadu
    const analysisResult = await this.llmAdapter.generateStructuredAnalysis<any>(
      promptPayload.messages,
      DUAL_PANE_COOPERATIVE_SCHEMA,
      0.5,
    );

    // 8. Proteksi Guardrail: Mencegah teks penolakan/obrolan AI menimpa draf artikel asli
    if (analysisResult.updatedArticle && analysisResult.updatedArticle.draftMarkdown) {
      const draft = analysisResult.updatedArticle.draftMarkdown.trim();
      const answer = (analysisResult.answer || '').trim();
      
      const isIdenticalToAnswer = draft === answer;
      const isRefusalKeyword = draft.includes('tidak ditemukan di dalam dokumen') || 
                              draft.includes('belum bisa ditulis') || 
                              draft.includes('belum menemukan isi artikel') ||
                              draft.includes('tidak memiliki akses');
      const isShortNonArticle = !draft.startsWith('#') && draft.length < 400;

      if (isIdenticalToAnswer || isRefusalKeyword || isShortNonArticle) {
        this.logger.warn(`[Guardrail] Mencegah pembaruan draf dengan teks penolakan/obrolan AI. Teks dicegah: "${draft.slice(0, 100)}..."`);
        delete analysisResult.updatedArticle;
      }
    }

    // 8.5 Sinkronisasi State Naskah Draf ke Database (Pane Kanan)
    if (analysisResult.updatedArticle && analysisResult.updatedArticle.draftMarkdown) {
      const updatedDraft = analysisResult.updatedArticle.draftMarkdown;
      const updatedTitle = analysisResult.updatedArticle.title || memory.articleTitle || memory.title;

      await this.chatRepository.updateActiveDraft(payload.sessionId, updatedDraft);
      await this.chatRepository.updateArticleMetadata(payload.sessionId, updatedTitle);

      this.logger.log(`[State Sync] Draf naskah dan judul artikel aktif berhasil disinkronkan ke PostgreSQL.`);
    }

    // 9. Simpan balasan AI Agent ke dalam riwayat obrolan (dengan metadata scrapedUrls jika ini adalah hasil proactive search)
    const assistantResponseContent = JSON.stringify(analysisResult);
    await this.chatMemory.recordAssistantMessage(
      payload.sessionId,
      assistantResponseContent,
      isProactiveSearch && proactiveScrapedUrls.length > 0 ? { scrapedUrls: proactiveScrapedUrls } : undefined
    );

    // 10. Kompresi Memori Latar Belakang (Asynchronous Compaction Guard)
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
    const previousSummary = memory.runningSummary || 'Belum ada riwayat pembicaraan.';
    const activeMessagesStr = memory.activeMessages
      .map((m: any) => `${m.role === 'USER' ? 'User' : 'Assistant'}: ${m.content}`)
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
        summary: { type: 'string', description: 'Ringkasan naratif gabungan baru.' },
      },
    };

    setImmediate(async () => {
      try {
        const result = await this.llmAdapter.generateStructuredAnalysis<{
          summary: string;
        }>(compactionPrompt, compactionSchema, 0.0);

        if (result && result.summary) {
          await this.chatMemory.updateRunningSummary(sessionId, result.summary);
          this.logger.log(`[Compaction Guard] Berhasil memperbarui Running Summary.`);
        }
      } catch (err: any) {
        this.logger.error(`[Compaction Guard Error] Gagal memadatkan memori: ${err.message}`);
      }
    });
  }
}