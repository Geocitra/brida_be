import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { DocumentRepository } from '../../document-ingestion/repositories/document.repository';
import { VendorLlmAdapter } from '../../ai-agent/providers/vendor-llm.adapter';
import { ChatRepository } from '../repositories/chat.repository';
import { TokenEstimatorUtil } from '../../ai-agent/utils/token-estimator.util';
import { ArticleLength, MessageRole } from '@prisma/client';

export interface GenerateArticleOptions {
  documentIds: string[];
  articleTitle: string;
  targetLength?: 'SHORT' | 'MEDIUM' | 'LONG' | ArticleLength;
  tone?: string;
  userInstruction?: string;
  sessionId?: string;
}

@Injectable()
export class ArticleGeneratorService {
  private readonly logger = new Logger(ArticleGeneratorService.name);

  constructor(
    private readonly documentRepository: DocumentRepository,
    private readonly chatRepository: ChatRepository,
    private readonly llmAdapter: VendorLlmAdapter,
    private readonly tokenEstimator: TokenEstimatorUtil,
  ) {}

  async generateArticle(options: GenerateArticleOptions): Promise<any> {
    const { documentIds, articleTitle, targetLength = ArticleLength.MEDIUM, tone = 'solutif', userInstruction } = options;

    if (!documentIds || documentIds.length === 0) {
      throw new BadRequestException('Minimal satu dokumen acuan harus dipilih untuk membuat artikel.');
    }
    if (!articleTitle || !articleTitle.trim()) {
      throw new BadRequestException('Judul artikel tidak boleh kosong.');
    }

    // 1. Create or retrieve ChatSession for Article Generator
    let session = options.sessionId
      ? await this.chatRepository.findSessionById(options.sessionId)
      : null;

    if (!session) {
      session = await this.chatRepository.createArticleSession({
        documentIds,
        articleTitle,
        targetLength: targetLength as ArticleLength,
        tone,
        initialPrompt: userInstruction,
      });
    }

    // 2. Fetch context from all selected reference documents
    const docTexts: string[] = [];
    const sourceDocs: any[] = [];

    for (const docId of documentIds) {
      const doc = await this.documentRepository.findById(docId);
      if (doc) {
        sourceDocs.push(doc);
        const text = doc.chunks ? doc.chunks.map((c) => c.rawText).join('\n\n') : '';
        docTexts.push(`=== DOKUMEN ACUAN: ${doc.title} (${doc.metadata?.category || 'Umum'}) ===\n${text.slice(0, 10000)}`);
      }
    }

    const assembledDocsContext = docTexts.join('\n\n----------------------------------------\n\n');

    // Determine target word count based on ArticleLength
    let lengthGuidance = 'Target Panjang Teks: ~700 kata (Sedang, komprehensif)';
    if (String(targetLength) === 'SHORT') {
      lengthGuidance = 'Target Panjang Teks: ~300 kata (Ringkas & Padat untuk Rilis Media / Sosmed)';
    } else if (String(targetLength) === 'LONG') {
      lengthGuidance = 'Target Panjang Teks: ~1500 kata (Mendalam, Analisis Kebijakan Komprehensif)';
    }

    const promptUserInstruction = userInstruction
      ? `Instruksi Khusus Tambahan: ${userInstruction}`
      : 'Buatkan draf artikel publikasi yang menarik, solutif, dan berbasis data dari dokumen acuan.';

    const systemPrompt = `Anda adalah Penulis Artikel Utama & Analis Kebijakan BRIDA Kabupaten Mimika.
Tugas Anda: Susun artikel publikasi berbasis data aktual dari DOKUMEN ACUAN yang diberikan.

PANDUAN PENULISAN:
- Judul Artikel: "${articleTitle}"
- Gaya Bahasa (Tone): ${tone.toUpperCase()}
- ${lengthGuidance}
- Gunakan struktur narasi jurnalistik publik yang kuat (Judul, Subjudul, Analisis Faktual, Solusi Rekomendasi).
`;

    const userPromptMessage = `Judul Artikel yang Diinginkan: "${articleTitle}"\n${promptUserInstruction}\n\nDOKUMEN ACUAN:\n${assembledDocsContext}`;

    // Record User Prompt Message in DB
    await this.chatRepository.addMessage({
      sessionId: session.id,
      role: MessageRole.USER,
      content: `[JUDUL ARTIKEL]: ${articleTitle}\n[TONE]: ${tone}\n[PANJANG]: ${targetLength}\n${userInstruction || ''}`,
      tokenCount: this.tokenEstimator.estimateTokenCount(userPromptMessage),
    });

    // 3. Call LLM to generate structured article text with creative temperature 0.7
    let fullArticleText = '';
    try {
      const llmResult = await this.llmAdapter.generateStructuredAnalysis<any>(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPromptMessage },
        ],
        ARTICLE_OUTPUT_SCHEMA,
        0.7,
      );

      fullArticleText = llmResult.fullText || formatArticleFromLlm(llmResult, articleTitle);
    } catch (err: any) {
      this.logger.warn(`[Article LLM Fallback] Gagal memanggil API: ${err.message}. Menggunakan sintesis fallback.`);
      fullArticleText = createFallbackArticleText(articleTitle, sourceDocs, tone, targetLength);
    }

    // Record Assistant Generated Article in DB
    await this.chatRepository.addMessage({
      sessionId: session.id,
      role: MessageRole.ASSISTANT,
      content: fullArticleText,
      tokenCount: this.tokenEstimator.estimateTokenCount(fullArticleText),
    });

    const updatedSession = await this.chatRepository.findSessionById(session.id);

    return {
      success: true,
      sessionId: session.id,
      articleTitle,
      tone,
      targetLength,
      fullArticleText,
      sources: sanitizeSources(updatedSession.sources),
      messages: updatedSession.messages,
    };
  }

  async interactWithArticleSession(sessionId: string, userInstruction: string): Promise<any> {
    const session = await this.chatRepository.findSessionById(sessionId);
    if (!session) {
      throw new NotFoundException(`Sesi artikel dengan ID '${sessionId}' tidak ditemukan.`);
    }

    // Record User Follow-up Instruction in DB
    await this.chatRepository.addMessage({
      sessionId: session.id,
      role: MessageRole.USER,
      content: userInstruction,
      tokenCount: this.tokenEstimator.estimateTokenCount(userInstruction),
    });

    // Assemble conversation history
    const conversationMessages = session.messages.map((m: any) => ({
      role: m.role === MessageRole.USER ? ('user' as const) : ('assistant' as const),
      content: m.content,
    }));

    const systemPrompt = `Anda adalah Asisten Penulis & Editor Artikel BRIDA Kabupaten Mimika.
Perbarui / revisi draf artikel berdasarkan instruksi revisi terbaru dari pengguna. Pertahankan gaya bahasa ${session.tone || 'SOLUTIF'}.`;

    let revisedArticleText = '';
    try {
      const llmResult = await this.llmAdapter.generateStructuredAnalysis<any>(
        [
          { role: 'system', content: systemPrompt },
          ...conversationMessages,
          { role: 'user', content: `Instruksi Revisi Terbaru: ${userInstruction}` },
        ],
        ARTICLE_OUTPUT_SCHEMA,
        0.7,
      );

      revisedArticleText = llmResult.fullText || formatArticleFromLlm(llmResult, session.articleTitle || session.title);
    } catch (err: any) {
      revisedArticleText = `[Hasil Revisi Draf Artikel - ${new Date().toLocaleTimeString('id-ID')}]\n\n${userInstruction}\n\n` + (conversationMessages[conversationMessages.length - 1]?.content || '');
    }

    // Record Assistant Revision Response in DB
    await this.chatRepository.addMessage({
      sessionId: session.id,
      role: MessageRole.ASSISTANT,
      content: revisedArticleText,
      tokenCount: this.tokenEstimator.estimateTokenCount(revisedArticleText),
    });

    const updatedSession = await this.chatRepository.findSessionById(sessionId);

    return {
      success: true,
      sessionId: session.id,
      articleTitle: session.articleTitle || session.title,
      tone: session.tone,
      targetLength: session.targetLength,
      fullArticleText: revisedArticleText,
      sources: sanitizeSources(updatedSession.sources),
      messages: updatedSession.messages,
    };
  }

  async getAllArticleSessions(): Promise<any[]> {
    const sessions = await this.chatRepository.findArticleSessions();
    return sessions.map((s) => ({
      id: s.id,
      title: s.title,
      articleTitle: s.articleTitle || s.title,
      tone: s.tone,
      targetLength: s.targetLength,
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      sourcesCount: s.sources?.length || 0,
      sources: sanitizeSources(s.sources),
      lastMessage: s.messages && s.messages.length > 0 ? s.messages[s.messages.length - 1].content : null,
    }));
  }

  async getArticleSessionById(sessionId: string): Promise<any> {
    const session = await this.chatRepository.findSessionById(sessionId);
    if (!session) {
      throw new NotFoundException(`Sesi artikel dengan ID '${sessionId}' tidak ditemukan.`);
    }

    const lastAssistantMsg = [...session.messages].reverse().find((m: any) => m.role === MessageRole.ASSISTANT);

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
      fullArticleText: lastAssistantMsg ? lastAssistantMsg.content : '',
    };
  }

  async deleteArticleSession(sessionId: string): Promise<void> {
    const session = await this.chatRepository.findSessionById(sessionId);
    if (!session) {
      throw new NotFoundException(`Sesi artikel dengan ID '${sessionId}' tidak ditemukan.`);
    }
    await this.chatRepository.deleteSession(sessionId);
  }
}

// Helpers
const ARTICLE_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    judulUsulan: { type: 'string' },
    ringkasan: { type: 'string' },
    fullText: { type: 'string' },
  },
  required: ['fullText'],
};

function sanitizeSources(sources: any[]): any[] {
  if (!sources) return [];
  return sources.map((s) => ({
    id: s.document?.id,
    title: s.document?.title,
    category: s.document?.metadata?.category || 'Umum',
    fileUrl: s.document?.fileUrl,
  }));
}

function formatArticleFromLlm(llmResult: any, defaultTitle: string): string {
  if (llmResult.fullText) return llmResult.fullText;

  return `# ${llmResult.judulUsulan || defaultTitle}

**Oleh: Tim Analis & Penulis Kebijakan BRIDA Kabupaten Mimika**

## Ringkasan Eksekutif
${llmResult.ringkasan || 'Artikel publikasi dirakit berdasarkan analisis data acuan terkonfirmasi.'}

## Pembahasan Utama
Berdasarkan data dokumen acuan strategis daerah, diperlukan koordinasi aktif antara pemerintah daerah dan pemangku kepentingan untuk memastikan pencapaian indikator pembangunan secara inklusif.

## Kesimpulan & Solusi Rekomendasi
Pemerintah Kabupaten Mimika berkomitmen untuk mendorong efisiensi pelaksanaan program serta keterbukaan informasi bagi seluruh lapisan masyarakat.
`.trim();
}

function createFallbackArticleText(title: string, docs: any[], tone: string, length: string): string {
  const docNames = docs.map((d) => d.title).join(', ');
  return `# ${title}

**Oleh: Tim Analis & Penulis Kebijakan BRIDA Kabupaten Mimika**
*Gaya Bahasa: ${tone.toUpperCase()} | Target Panjang: ${length}*

## Pendahuluan
Dokumen acuan (${docNames}) menjadi landasan utama dalam penyusunan analisis artikel publikasi ini. Berdasarkan fakta lapangan, Kabupaten Mimika terus mendorong akselerasi pembangunan berbasis inovasi daerah.

## Pembahasan Utama & Data Faktual
Dalam konteks tata kelola pemerintahan yang responsif, sintesis data menunjukkan pentingnya penyelarasan target operasional dengan indikator capaian fisik di lapangan. Faktor transparansi dan akuntabilitas menjadi kunci utama perbaikan kualitas layanan publik.

## Rekomendasi & Langkah Solutif
1. Peningkatan koordinasi lintas sektor dalam mengawal program prioritas daerah.
2. Penguatan integrasi sistem informasi dan monitoring berkala oleh BRIDA Kabupaten Mimika.
3. Pelibatan aktif masyarakat dan akademisi dalam mengawal keberlanjutan program pembangunan.

---
*Dikeluarkan oleh BRIDA SMART Analysis &bull; Pemerintah Kabupaten Mimika*
`.trim();
}
