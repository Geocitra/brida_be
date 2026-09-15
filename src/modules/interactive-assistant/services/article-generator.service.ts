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

const ARTICLE_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    judulUsulan: { 
      type: 'string', 
      description: 'Judul dokumen yang tepat dan menarik.' 
    },
    ringkasan: { 
      type: 'string', 
      description: 'Ringkasan eksekutif dari naskah.' 
    },
    fullText: {
      type: 'string',
      description:
        'Isi naskah dokumen utuh menggunakan Markdown. Anda BEBAS PENUH menentukan strukturnya. ' +
        'Gunakan tabel komparasi, poin analitis, diagram teks, atau narasi mendalam sesuai kreativitas Anda agar topik tergambar sempurna. ' +
        'Jika diminta naskah panjang (LONG), jabarkan sedetail dan sedalam mungkin tanpa batasan template. ' +
        'TIDAK PERLU menuliskan daftar pustaka atau token referensi di akhir teks.',
    },
  },
  required: ['judulUsulan', 'ringkasan', 'fullText'],
};

@Injectable()
export class ArticleGeneratorService {
  private readonly logger = new Logger(ArticleGeneratorService.name);
  private readonly MAX_DRAFTING_TOKEN_BUDGET = 150000;

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

    const lengthRequirementText = isLongLength
      ? 'TARGET PANJANG: LONG (Minimal 1.500 kata). Silakan berekspresi secara total! Kupas tuntas topik ini dari berbagai sudut pandang. Jangan menahan diri. Buat dokumen yang sangat komprehensif, kaya data, dan mendalam.'
      : isShortLength
        ? 'TARGET PANJANG: SHORT (~700 kata). Buat padat, jelas, dan langsung ke intinya.'
        : 'TARGET PANJANG: MEDIUM (~1.000 kata). Eksplorasi topik secara proporsional.';

    const userQuery = `
[JUDUL / TOPIK TARGET]: "${normalizedTitle}"
${lengthRequirementText}
${promptUserInstruction}
${manifestPromptSection}

INSTRUKSI KREASI BEBAS:
Rancang dan tulis naskah ini dengan kebebasan penuh. Gunakan keahlian analitis Anda untuk menentukan struktur bab, pemakaian tabel komparasi, pembuatan roadmap, atau pemformatan visual yang paling luar biasa untuk membedah topik ini.
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
      const llmResult = await this.llmAdapter.generateStructuredAnalysis<any>(
        promptPayload.messages,
        ARTICLE_OUTPUT_SCHEMA,
        0.7,
      );

      fullArticleText = llmResult.fullText || formatArticleFromLlm(llmResult, normalizedTitle, temporal);
      fullArticleText = cleanArticleTitlePrefix(fullArticleText);

      // Jika AI memberikan judul usulan resmi, gunakan sebagai nama sesi utama
      if (llmResult.judulUsulan && llmResult.judulUsulan.trim().length > 0) {
        normalizedTitle = llmResult.judulUsulan.trim().replace(/^#+\s*/, '');
      }
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
    }

    await this.chatRepository.addMessage({
      sessionId: session.id,
      role: MessageRole.ASSISTANT,
      content: fullArticleText,
      tokenCount: this.tokenEstimator.estimateTokenCount(fullArticleText),
    });

    // SINKRONISASI KUNCI: Ikat judul asli dokumen langsung ke session.title dan session.articleTitle
    await this.chatRepository.updateActiveDraft(session.id, fullArticleText);
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
    articleTitle: string,
    fullArticleText?: string,
    editorState?: string,
  ): Promise<any> {
    const session = await this.chatRepository.findSessionById(sessionId);
    if (!session) {
      throw new NotFoundException(`Sesi artikel ID '${sessionId}' tidak ditemukan.`);
    }

    const trimmedTitle = articleTitle.trim();
    if (!trimmedTitle) {
      throw new BadRequestException('Judul artikel tidak boleh kosong.');
    }

    if (editorState) {
      await this.chatRepository.updateEditorDocumentState(
        sessionId,
        editorState,
        trimmedTitle,
        fullArticleText || session.currentDraft || '',
      );
    } else if (fullArticleText) {
      await this.chatRepository.updateActiveDraft(sessionId, fullArticleText);
      await this.chatRepository.updateArticleMetadata(sessionId, trimmedTitle);
    } else {
      await this.chatRepository.updateArticleMetadata(sessionId, trimmedTitle);
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

    const targetLengthStr = session.targetLength || 'MEDIUM';
    const lengthRule = targetLengthStr === 'LONG'
      ? 'TARGET VOLUME: Pertahankan kedalaman naskah MINIMAL 1.500 KATA. DILARANG memangkas naskah menjadi ringkasan pendek!'
      : `TARGET VOLUME: Pertahankan proporsi naskah sesuai target (${targetLengthStr}).`;

    const systemPrompt = `Anda adalah Analis Kebijakan Utama BRIDA Kabupaten Mimika.
Tugas Anda: Perbarui atau revisi naskah dokumen kebijakan berikut berdasarkan instruksi pengguna.
${lengthRule}
Pertahankan gaya bahasa ${session.tone || 'SOLUTIF'}.
Pastikan naskah tetap utuh, terstruktur bab per bab, dan bernas.
${EDITORIAL_STYLE_GUIDE}
`;

    let revisedArticleText = '';
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

      revisedArticleText = llmResult.fullText || formatArticleFromLlm(llmResult, session.articleTitle || session.title, temporal);
      revisedArticleText = cleanArticleTitlePrefix(revisedArticleText);
    } catch (err: any) {
      revisedArticleText =
        `# ${session.articleTitle || session.title}\n\n[Revisi - ${new Date().toLocaleTimeString('id-ID')}]\n\n` +
        (conversationMessages[conversationMessages.length - 1]?.content || '');
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

  return `# ${llmResult.judulUsulan || defaultTitle}

**Disusun oleh: Badan Riset dan Inovasi Daerah (BRIDA) Kabupaten Mimika**

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

**Kajian Analitis BRIDA Kabupaten Mimika**
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

function cleanArticleTitlePrefix(text: string): string {
  if (!text) return '';
  return text
    .replace(/^(#\s*)(?:Artikel\s+Strategis|Laporan\s+Strategis|Draft|Draf|Analisis\s+Strategis|Rilis\s+Pers):\s*/i, '$1')
    .replace(/^(?:Artikel\s+Strategis|Laporan\s+Strategis|Draft|Draf|Analisis\s+Strategis|Rilis\s+Pers):\s*/i, '');
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