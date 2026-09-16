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
        'ATURAN KEPADATAN STRUKTURAL MUTLAK: ' +
        'Setiap bab atau sub-bagian pembahasan (##) WAJIB diuraikan MINIMAL 150 KATA dalam 2 sampai 4 paragraf tebal (tiap paragraf berisi 4-7 kalimat berbobot). ' +
        'DILARANG KERAS memecah naskah menjadi banyak sub-heading kecil (###) yang hanya berisi 1-2 kalimat pendek. ' +
        'Gunakan Markdown Image QuickChart (https://quickchart.io/chart?...) untuk memvisualisasikan data statistik jika ada. ' +
        'Kembangkan narasi argumentasi secara ekstensif sesuai target panjang teks (SHORT: ~750 kata, MEDIUM: ~1.500 kata, atau LONG: MINIMAL 3.000 KATA HINGGA 4.000 KATA PENUH). ' +
        'TIDAK PERLU mencantumkan bab daftar pustaka/referensi di akhir teks atau token sitasi mesin; manfaatkan seluruh kuota kata untuk analisis tuntas.',
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
      ? 'TARGET PANJANG NASKAH: MINIMAL 3.000 HINGGA 4.000 KATA PENUH (Sangat Mendalam & Ekstensif). ' +
        'Susun dalam 5–7 Bab utama (##). KETENTUAN KEPADATAN MUTLAK: Setiap bab/bagian WAJIB memiliki minimal 450–600 kata yang diuraikan dalam 3–5 paragraf tebal dan berbobot. ' +
        'DILARANG KERAS membuat naskah pendek atau memecah teks menjadi belasan sub-heading kecil satu kalimat. ' +
        'Silakan berekspresi secara total, kupas tuntas topik dari berbagai sudut pandang, dan wajib sertakan grafik visual QuickChart jika ada komparasi data.'
      : isShortLength
        ? 'TARGET PANJANG NASKAH: ~750 KATA PENUH (Padat, Bernas & Terfokus). ' +
          'Susun dalam 3–4 Bab utama (##). Setiap bagian WAJIB memiliki minimal 150–250 kata yang diuraikan dalam 2–3 paragraf tebal.'
        : 'TARGET PANJANG NASKAH: ~1.500 KATA PENUH (Komprehensif, Proporsional & Mendalam). ' +
          'Susun dalam 4–5 Bab utama (##). Setiap bagian WAJIB memiliki minimal 300–400 kata yang diuraikan dalam 2–4 paragraf tebal.';

    const userQuery = `
[JUDUL DOKUMEN TARGET]: "${normalizedTitle}"
${lengthRequirementText}
${promptUserInstruction}
${manifestPromptSection}

INSTRUKSI KREASI BEBAS:
Rancang dan tulis naskah ini dengan kebebasan penuh. Gunakan keahlian analitis Anda untuk menentukan struktur bab yang mengalir alami. Jangan lupa sisipkan grafik visual (Pie/Bar Chart via QuickChart API) untuk membuat naskah tampil sangat profesional.
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

      // TERAPKAN NORMALISASI: Kunci Judul Resmi sebagai H1 paling atas di naskah fisik
      fullArticleText = ensureDocumentTitleHeader(fullArticleText, normalizedTitle);
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
ATURAN KEPADATAN: Setiap bab/bagian (##) harus memiliki minimal 150 kata yang tersusun dalam 2-4 paragraf tebal. Dilarang membuat heading tipis 1-2 kalimat.
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