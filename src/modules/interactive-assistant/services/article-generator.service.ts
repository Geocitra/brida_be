import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  PayloadTooLargeException // Penanganan defensive anggaran token [5, 7]
} from '@nestjs/common';
import { DocumentRepository } from '../../document-ingestion/repositories/document.repository';
import { VendorLlmAdapter } from '../../ai-agent/providers/vendor-llm.adapter';
import { ChatRepository } from '../repositories/chat.repository';
import { TokenEstimatorUtil } from '../../ai-agent/utils/token-estimator.util';
import { ArticleLength, MessageRole, SessionType } from '@prisma/client';

export interface GenerateArticleOptions {
  documentIds: string[];
  articleTitle: string;
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
    kesiaxialRingkas?: string;
  };
  parentSessionId?: string;
}

@Injectable()
export class ArticleGeneratorService {
  private readonly logger = new Logger(ArticleGeneratorService.name);

  // Anggaran token keras maksimum untuk sintesis draf artikel (20.000 token)
  private readonly MAX_DRAFTING_TOKEN_BUDGET = 20000;

  constructor(
    private readonly documentRepository: DocumentRepository,
    private readonly chatRepository: ChatRepository,
    private readonly llmAdapter: VendorLlmAdapter,
    private readonly tokenEstimator: TokenEstimatorUtil,
  ) { }

  /**
   * Mensintesis draf naskah artikel baru berdasarkan multi-dokumen rujukan,
   * dengan jaminan output format Markdown bersih dan terstandarisasi.
   */
  async generateArticle(options: GenerateArticleOptions): Promise<any> {
    const {
      documentIds,
      articleTitle,
      targetLength = ArticleLength.MEDIUM,
      tone = 'solutif',
      userInstruction,
      synthesizedManifest,
      parentSessionId
    } = options;

    const validDocIds = documentIds || [];
    if (!articleTitle || !articleTitle.trim()) {
      throw new BadRequestException('Judul artikel tidak boleh kosong.');
    }

    // 1. Ambil atau buat ChatSession baru untuk Article Generator
    let session = options.sessionId
      ? await this.chatRepository.findSessionById(options.sessionId)
      : null;

    if (!session) {
      session = await this.chatRepository.createArticleSession({
        documentIds: validDocIds,
        articleTitle,
        targetLength: targetLength as ArticleLength,
        tone,
        initialPrompt: userInstruction,
        parentSessionId,
      });
    }

    // 2. Ekstraksi konteks dari seluruh dokumen acuan terpilih (Hibrida Lokal & Eksternal)
    const docTexts: string[] = [];
    const sourceDocs: any[] = [];

    for (const docId of validDocIds) {
      const doc = await this.documentRepository.findById(docId);
      if (doc) {
        sourceDocs.push(doc);
        const text = doc.chunks ? doc.chunks.map((c: (typeof doc.chunks)[number]) => c.rawText).join('\n\n') : '';
        const category = doc.metadata?.category || 'Umum';

        // Asersi tipe dinamis yang aman untuk menghindari kegagalan kompilasi jika Prisma client belum di-generate ulang
        const sourceUrl = (doc.metadata as any)?.sourceUrl;
        const sourceUrlText = sourceUrl ? `\nSumber Tautan Web: ${sourceUrl}` : '';

        docTexts.push(
          `=== DOKUMEN ACUAN: ${doc.title} (Kategori: ${category})${sourceUrlText} ===\n${text.slice(0, 10000)}`
        );
      }
    }

    const assembledDocsContext = docTexts.join('\n\n----------------------------------------\n\n');

    let lengthGuidance = 'Target Panjang Teks: Minimal 1000 kata (Sedang, komprehensif)';
    if (String(targetLength) === 'SHORT') {
      lengthGuidance = 'Target Panjang Teks: Minimal 700 kata (Ringkas & Padat untuk Rilis Media)';
    } else if (String(targetLength) === 'LONG') {
      lengthGuidance = 'Target Panjang Teks: Minimal 1500 kata (Mendalam, Analisis Kebijakan Komprehensif)';
    }

    // Bangun seksi prompt berbasis Of-Record manifest diskusi (SSM) jika ada [Two-Pass Pipeline]
    let manifestPromptSection = '';
    if (synthesizedManifest) {
      const argumenList = Array.isArray(synthesizedManifest.argumenKunci)
        ? synthesizedManifest.argumenKunci
          .map((arg, idx) => `- Poin ${idx + 1}: "${arg.fakta}" (WAJIB lampirkan sitasi asli: ${arg.sitasiAsli})`)
          .join('\n')
        : 'Tidak ada argumen spesifik.';

      manifestPromptSection = `
=== STRUKTUR KONSENSUS HASIL DISKUSI SEBELUMNYA (SSM) ===
Anda WAJIB menyusun alur narasi artikel ini mengikuti kerangka konseptual diskusi yang telah disepakati sebagai berikut:
- Tesis Utama Artikel: "${synthesizedManifest.tesisUtama}"
- Argumen Utama & Bukti Faktual:
${argumenList}

ATURAN RE-PROPAGASI SITASI MUTLAK:
Ketika Anda menyusun paragraf yang membahas poin-poin di atas, Anda WAJIB menyematkan kembali token sitasi aslinya secara presisi (misal: [docId:chunkIndex]) bersebelahan dengan klaim data tersebut agar orisinalitas riset BRIDA dapat ditelusuri.
`;
    }

    const promptUserInstruction = userInstruction
      ? `Instruksi Khusus Tambahan: ${userInstruction}`
      : 'Buatkan draf artikel publikasi yang menarik, solutif, dan berbasis data/ide yang kuat.';

    // SYSTEM PROMPT: Enforcing strict CommonMark compliance (No HTML inline styles)
    const systemPrompt = `Anda adalah Penulis Artikel Utama & Analis Kebijakan BRIDA Kabupaten Mimika.
${validDocIds.length > 0
        ? 'Tugas Anda: Susun artikel publikasi berbasis data aktual dari DOKUMEN ACUAN yang diberikan.'
        : 'Tugas Anda: Susun artikel publikasi berdasarkan instruksi dan pengetahuan internal Anda (Mode Kreasi Bebas).'
      }

PANDUAN PENULISAN:
- Judul Artikel: "${articleTitle}"
- Gaya Bahasa (Tone): ${tone.toUpperCase()}
- ${lengthGuidance}
- Gunakan struktur narasi jurnalistik publik yang kuat (Judul, Subjudul, Analisis Faktual, Solusi Rekomendasi).
${manifestPromptSection}

ATURAN FORMATTING MUTLAK (COMMONMARK COMPLIANCE - ZERO RANDOM HTML):
1. DILARANG KERAS menghasilkan atau menyisipkan tag HTML pemformatan visual mentah kustom (seperti <p style="...">, <font>, <span style="...">, dll.) ke dalam isi naskah artikel.
2. Semua bentuk daftar/poin wajib ditulis menggunakan simbol list standar CommonMark: gunakan tanda minus (-) atau bintang (*) diikuti oleh spasi (misalnya: - Poin Rekomendasi). Jangan gunakan tag HTML <ul> atau <li> secara manual.
3. Penulisan judul/subjudul bab wajib menggunakan sintaks header ATX standar (# untuk Judul Utama, ## untuk Sub-judul, ### untuk Sub-sub-judul).
4. Hindari manipulasi layout seperti menyematkan properti alignment teks visual secara inline dalam HTML. Biarkan representasi struktur dokumen murni menggunakan sintaks Markdown bersih.
5. DILARANG keras menyertakan awalan label seperti "Artikel Strategis:", "Laporan:", "Draft:", "Draf:", atau sejenisnya sebelum Judul Utama. Tuliskan Judul Utama naskah (Header H1 '#') secara langsung, bersih, dan profesional.
`;

    const userPromptMessage = validDocIds.length > 0
      ? `Judul Artikel yang Diinginkan: "${articleTitle}"\n${promptUserInstruction}\n\nDOKUMEN ACUAN:\n${assembledDocsContext}`
      : `Judul Artikel yang Diinginkan: "${articleTitle}"\n${promptUserInstruction}`;

    // --- INTEGRASI TOKEN BUDGET CIRCUIT BREAKER (DEFENSIVE PROGRAMMING) [5, 7] ---
    const compiledPrompts = [systemPrompt, userPromptMessage];
    this.tokenEstimator.enforceBudgetCircuitBreaker({
      texts: compiledPrompts,
      imagesCount: 0,
      maxBudgetTokens: this.MAX_DRAFTING_TOKEN_BUDGET,
    });

    // Rekam pesan prompt pengguna ke database PostgreSQL
    await this.chatRepository.addMessage({
      sessionId: session.id,
      role: MessageRole.USER,
      content: `[JUDUL ARTIKEL]: ${articleTitle}\n[TONE]: ${tone}\n[PANJANG]: ${targetLength}\n${userInstruction || ''}`,
      tokenCount: this.tokenEstimator.estimateTokenCount(userPromptMessage),
    });

    // 3. Panggil LLM Adapter dengan parameter kreatif (temperature 0.7)
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
      fullArticleText = cleanArticleTitlePrefix(fullArticleText);
    } catch (err: any) {
      this.logger.warn(`[Article LLM Fallback] Gagal memanggil API: ${err.message}. Menggunakan sintesis fallback.`);
      fullArticleText = createFallbackArticleText(articleTitle, sourceDocs, tone, targetLength);
      fullArticleText = cleanArticleTitlePrefix(fullArticleText);
    }

    // Rekam draf artikel yang berhasil disintesis asisten ke DB
    await this.chatRepository.addMessage({
      sessionId: session.id,
      role: MessageRole.ASSISTANT,
      content: fullArticleText,
      tokenCount: this.tokenEstimator.estimateTokenCount(fullArticleText),
    });

    const updatedSession = await this.chatRepository.findSessionById(session.id);

    return {
      success: true,
      id: session.id,
      sessionId: session.id,
      articleTitle,
      tone,
      targetLength,
      fullArticleText,
      sources: sanitizeSources(updatedSession.sources),
      messages: updatedSession.messages,
    };
  }

  /**
   * Memperbarui konten draf naskah artikel secara manual berdasarkan suntingan editor (Two-Way Sync).
   * Mengintegrasikan audit log ke dalam riwayat percakapan tanpa mengubah struktur tabel database.
   */
  async updateArticleContent(
    sessionId: string,
    articleTitle: string,
    fullArticleText: string,
  ): Promise<any> {
    const session = await this.chatRepository.findSessionById(sessionId);
    if (!session) {
      throw new NotFoundException(`Sesi artikel dengan ID '${sessionId}' tidak ditemukan.`);
    }

    if (session.sessionType !== SessionType.ARTICLE_GENERATOR) {
      throw new BadRequestException('Sesi ini bukan merupakan sesi penulisan rilis artikel.');
    }

    const trimmedTitle = articleTitle.trim();
    if (!trimmedTitle) {
      throw new BadRequestException('Judul artikel baru tidak boleh kosong.');
    }

    // 1. Sinkronisasi judul draf pada metadata sesi obrolan di database
    if (typeof (this.chatRepository as any).updateArticleMetadata === 'function') {
      await (this.chatRepository as any).updateArticleMetadata(sessionId, trimmedTitle);
    } else {
      this.logger.warn(
        `[Integrasi Repository] 'updateArticleMetadata' belum terimplementasi pada ChatRepository.`,
      );
    }

    // 2. Tambah Jejak Audit (Audit Trail Log) sebagai pesan sistem otomatis ke DB
    const auditContent = 'Naskah diperbarui secara manual oleh editor.';
    await this.chatRepository.addMessage({
      sessionId: session.id,
      role: MessageRole.SYSTEM,
      content: auditContent,
      tokenCount: this.tokenEstimator.estimateTokenCount(auditContent),
    });

    // 3. Simpan draf naskah hasil suntingan manual terbaru sebagai pesan asisten baru
    await this.chatRepository.addMessage({
      sessionId: session.id,
      role: MessageRole.ASSISTANT,
      content: fullArticleText,
      tokenCount: this.tokenEstimator.estimateTokenCount(fullArticleText),
    });

    this.logger.log(
      `[Draft Manual Sync] Berhasil melakukan pembaruan naskah manual untuk Sesi ID: ${sessionId}`,
    );

    const updatedSession = await this.chatRepository.findSessionById(sessionId);

    return {
      success: true,
      id: session.id,
      sessionId: session.id,
      articleTitle: trimmedTitle,
      tone: updatedSession.tone,
      targetLength: updatedSession.targetLength,
      fullArticleText: fullArticleText,
      sources: sanitizeSources(updatedSession.sources),
      messages: updatedSession.messages,
    };
  }

  /**
   * Menangani diskusi revisi kolaboratif untuk memperbarui dokumen aktif.
   * Menjamin format tetap dalam bentuk Markdown standar demi meminimalkan noise pada RAG.
   */
  async interactWithArticleSession(sessionId: string, userInstruction: string): Promise<any> {
    const session = await this.chatRepository.findSessionById(sessionId);
    if (!session) {
      throw new NotFoundException(`Sesi artikel dengan ID '${sessionId}' tidak ditemukan.`);
    }

    // Rekam pesan instruksi revisi baru dari pengguna ke DB
    await this.chatRepository.addMessage({
      sessionId: session.id,
      role: MessageRole.USER,
      content: userInstruction,
      tokenCount: this.tokenEstimator.estimateTokenCount(userInstruction),
    });

    // Susun riwayat percakapan revisi
    const conversationMessages = session.messages.map((m: any) => ({
      role: m.role === MessageRole.USER ? ('user' as const) : ('assistant' as const),
      content: m.content,
    }));

    // SYSTEM PROMPT: Enforcing strict CommonMark compliance (No HTML inline styles) during iterations
    const systemPrompt = `Anda adalah Asisten Penulis & Editor Artikel BRIDA Kabupaten Mimika.
Perbarui / revisi draf naskah artikel berdasarkan instruksi revisi terbaru dari pengguna. Pertahankan gaya bahasa ${session.tone || 'SOLUTIF'}.

ATURAN FORMATTING MUTLAK (COMMONMARK COMPLIANCE - ZERO RANDOM HTML):
1. DILARANG KERAS menghasilkan atau menyisipkan tag HTML kustom visual (seperti <p style="...">, <font>, dll.) ke dalam teks naskah revisi Anda.
2. Semua daftar wajib menggunakan simbol list standar CommonMark: gunakan tanda minus (-) atau bintang (*) diikuti oleh spasi (misalnya: - Poin Evaluasi). Jangan gunakan tag HTML <ul> atau <li> secara manual.
3. Penulisan judul/subjudul wajib menggunakan sintaks header ATX standar (#, ##, ###).
4. Hasil revisi naskah harus dikembalikan sebagai Markdown bersih, terstruktur, dan memiliki keterbacaan tinggi.
5. DILARANG keras menyertakan awalan label seperti "Artikel Strategis:", "Laporan:", "Draft:", "Draf:", atau sejenisnya sebelum Judul Utama. Tuliskan Judul Utama naskah secara langsung, bersih, dan profesional.
`;

    // --- INTEGRASI TOKEN BUDGET CIRCUIT BREAKER PADA PROSES INTERAKSI REVISI [5, 7] ---
    const rawConversationTexts = conversationMessages.map((m: any) => m.content).concat([systemPrompt, userInstruction]);
    this.tokenEstimator.enforceBudgetCircuitBreaker({
      texts: rawConversationTexts,
      imagesCount: 0,
      maxBudgetTokens: this.MAX_DRAFTING_TOKEN_BUDGET,
    });

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
      revisedArticleText = cleanArticleTitlePrefix(revisedArticleText);
    } catch (err: any) {
      revisedArticleText = `[Hasil Revisi Draf Artikel - ${new Date().toLocaleTimeString('id-ID')}]\n\n${userInstruction}\n\n` + (conversationMessages[conversationMessages.length - 1]?.content || '');
    }

    // Rekam draf revisi terbaru ke DB
    await this.chatRepository.addMessage({
      sessionId: session.id,
      role: MessageRole.ASSISTANT,
      content: revisedArticleText,
      tokenCount: this.tokenEstimator.estimateTokenCount(revisedArticleText),
    });

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

    let fullArticleText = '';
    if (lastAssistantMsg) {
      try {
        const parsed = JSON.parse(lastAssistantMsg.content);
        if (parsed && typeof parsed === 'object') {
          if (parsed.updatedArticle && parsed.updatedArticle.draftMarkdown) {
            fullArticleText = parsed.updatedArticle.draftMarkdown;
          } else {
            fullArticleText = parsed.answer || parsed.fullArticleText || lastAssistantMsg.content;
          }
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
      fullArticleText,
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

// Skema output visual naskah
const ARTICLE_OUTPUT_SCHEMA = {
  type: 'object',
  properties: {
    judulUsulan: { type: 'string' },
    ringkasan: { type: 'string' },
    fullText: {
      type: 'string',
      description: 'Isi lengkap naskah artikel dalam format CommonMark Markdown bersih (tanpa tag HTML kustom visual).'
    },
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

function cleanArticleTitlePrefix(text: string): string {
  if (!text) return '';
  // Menghapus awalan klasifikasi dari H1 header di awal dokumen
  let cleaned = text.replace(/^(#\s*)(?:Artikel\s+Strategis|Laporan\s+Strategis|Draft|Draf|Analisis\s+Strategis|Rilis\s+Pers):\s*/i, '$1');
  // Menghapus awalan klasifikasi jika tanpa H1 header di awal dokumen
  cleaned = cleaned.replace(/^(?:Artikel\s+Strategis|Laporan\s+Strategis|Draft|Draf|Analisis\s+Strategis|Rilis\s+Pers):\s*/i, '');
  return cleaned;
}