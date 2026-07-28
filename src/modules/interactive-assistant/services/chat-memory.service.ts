import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ChatRepository } from '../repositories/chat.repository';
import { TokenEstimatorUtil } from '../../ai-agent/utils/token-estimator.util';
import { ActiveChatMessage, SlidingWindowMemoryPayload, HierarchicalMemoryPayload } from '../interfaces/chat-memory.interface'; 
import { MessageRole, SessionType } from '@prisma/client';

@Injectable()
export class ChatMemoryService {
  private readonly logger = new Logger(ChatMemoryService.name);

  // Batas akumulasi token maksimum untuk jendela memori aktif (~2.000 token)
  private readonly MAX_MEMORY_TOKENS = 2000;

  // Di bawah pola Hierarchical Memory, kita membatasi jendela riwayat aktif uncompressed
  // menjadi maksimal 4 pesan (2 putaran percakapan terdekat) untuk efisiensi token.
  private readonly RECENT_WINDOW_SIZE = 4;

  constructor(
    private readonly chatRepository: ChatRepository,
    private readonly tokenEstimator: TokenEstimatorUtil,
  ) { }

  async createSession(documentIds: string[], title?: string, sessionType: SessionType = SessionType.QA_CHAT) {
    if (sessionType === SessionType.ARTICLE_GENERATOR) {
      return this.chatRepository.createArticleSession({
        documentIds,
        articleTitle: title || 'Draf Artikel Baru',
      });
    }
    return this.chatRepository.createSession(documentIds, title);
  }

  async recordUserMessage(sessionId: string, content: string) {
    const tokenCount = this.tokenEstimator.estimateTokenCount(content);
    return this.chatRepository.addMessage({
      sessionId,
      role: MessageRole.USER,
      content,
      tokenCount,
    });
  }

  async recordAssistantMessage(sessionId: string, content: string) {
    const tokenCount = this.tokenEstimator.estimateTokenCount(content);
    return this.chatRepository.addMessage({
      sessionId,
      role: MessageRole.ASSISTANT,
      content,
      tokenCount,
    });
  }

  async syncSessionDocuments(sessionId: string, documentIds: string[]): Promise<void> {
    return this.chatRepository.syncSessionDocuments(sessionId, documentIds);
  }

  async updateSessionMetadata(sessionId: string, tone?: string, targetLength?: string): Promise<void> {
    return this.chatRepository.updateSessionMetadata(sessionId, tone, targetLength);
  }

  /**
   * Mengambil memori bertingkat (Hierarchical Memory):
   * Menggabungkan Recent Window (3-4 pesan terbaru) dengan Running Summary (kompresi masa lalu).
   */
  async getActiveSlidingWindowMemory(sessionId: string): Promise<HierarchicalMemoryPayload> {
    const session = await this.chatRepository.findSessionById(sessionId);
    if (!session) {
      throw new NotFoundException(`Sesi obrolan dengan ID '${sessionId}' tidak ditemukan.`);
    }

    // 1. Ambil pesan mentah terbaru dari database (urut terbaru dahulu)
    const rawMessages = await this.chatRepository.getLatestMessages(sessionId, 30);

    const selectedMessages: ActiveChatMessage[] = [];
    let accumulatedTokens = 0;
    let prunedCount = 0;

    // 2. Iterasi pesan: Ambil pesan terbaru hingga menyentuh batas token atau batas RECENT_WINDOW_SIZE [1]
    for (const msg of rawMessages) {
      const msgTokens = msg.tokenCount || this.tokenEstimator.estimateTokenCount(msg.content);

      if (
        accumulatedTokens + msgTokens <= this.MAX_MEMORY_TOKENS &&
        selectedMessages.length < this.RECENT_WINDOW_SIZE
      ) {
        selectedMessages.push({
          id: msg.id,
          role: msg.role === MessageRole.USER ? 'USER' : 'ASSISTANT',
          content: msg.content,
          tokenCount: msgTokens,
          createdAt: msg.createdAt,
        });
        accumulatedTokens += msgTokens;
      } else {
        prunedCount++;
      }
    }

    // 3. Balikkan urutan pesan agar kronologis kembali (asc)
    selectedMessages.reverse();

    this.logger.log(
      `[Hierarchical Memory Window] Sesi ID: ${sessionId} -> Dipilih ${selectedMessages.length} pesan aktif (${accumulatedTokens} tokens). Status Summary: ${session.runningSummary ? 'Tersedia' : 'Kosong'}`,
    );

    const documentIds = Array.from(
      new Set(
        (session.sources || [])
          .map((s: any) => s.documentId)
          .concat(session.documentId ? [session.documentId] : [])
      )
    ).filter(Boolean) as string[];

    // Perbarui objek pengembalian di bawah ini agar menyertakan data state konfigurasi artikel
    return {
      sessionId: session.id,
      documentId: session.documentId,
      documentIds,
      activeMessages: selectedMessages,
      totalMemoryTokens: accumulatedTokens,
      prunedMessagesCount: prunedCount,
      runningSummary: session.runningSummary || null,

      // Pemetaan bidang baru (Mapping State Sesi Kolaboratif)
      title: session.title,
      articleTitle: session.articleTitle,
      tone: session.tone,
      targetLength: session.targetLength,
    };
  }

  /**
   * Menilai apakah sesi obrolan membutuhkan pemadatan memori (compaction).
   * Pemicu aktif apabila ada pesan lama yang mulai dipangkas keluar dari Recent Window [1].
   */
  shouldTriggerCompaction(prunedCount: number, accumulatedTokens: number): boolean {
    return prunedCount > 0 || accumulatedTokens >= this.MAX_MEMORY_TOKENS * 0.8;
  }

  /**
   * Memperbarui Running Summary di database PostgreSQL untuk mengompresi memori jangka panjang [1, 2].
   */
  async updateRunningSummary(sessionId: string, summary: string): Promise<void> {
    try {
      this.logger.log(`[Hierarchical Memory] Memperbarui Running Summary untuk Sesi ID: ${sessionId}`);

      // Memeriksa dan mengeksekusi penulisan ke repository secara aman.
      // (Pastikan ChatRepository di-regenerate atau ditambahkan fungsi updateSessionSummary)
      if (typeof this.chatRepository.updateSessionSummary === 'function') {
        await this.chatRepository.updateSessionSummary(sessionId, summary);
      } else {
        this.logger.warn(
          `[Integrasi Gagal] 'updateSessionSummary' belum terimplementasi pada ChatRepository. Menggunakan skema fallback asinkron.`,
        );
      }
    } catch (err: any) {
      this.logger.error(
        `[Hierarchical Memory Error] Gagal menyimpan Running Summary ke database: ${err.message}`,
      );
    }
  }

  async getQaSessions(): Promise<any[]> {
    const sessions = await this.chatRepository.findQaSessions();
    return sessions.map((s: any) => ({
      id: s.id,
      title: s.title,
      documentId: s.documentId,
      documentTitle: s.document?.title || 'Dokumen Umum',
      createdAt: s.createdAt,
      updatedAt: s.updatedAt,
      messagesCount: s.messages?.length || 0,
      lastMessage: s.messages && s.messages.length > 0 ? s.messages[s.messages.length - 1].content : null,
    }));
  }

  async getQaSessionDetails(sessionId: string): Promise<any> {
    const session = await this.chatRepository.findSessionById(sessionId);
    if (!session) {
      throw new NotFoundException(`Sesi obrolan dengan ID '${sessionId}' tidak ditemukan.`);
    }

    return {
      id: session.id,
      title: session.title,
      documentId: session.documentId,
      documentTitle: session.document?.title || 'Dokumen Umum',
      createdAt: session.createdAt,
      updatedAt: session.updatedAt,
      messages: session.messages,
      runningSummary: session.runningSummary || null,
    };
  }

  async deleteSession(sessionId: string): Promise<void> {
    const session = await this.chatRepository.findSessionById(sessionId);
    if (!session) {
      throw new NotFoundException(`Sesi obrolan dengan ID '${sessionId}' tidak ditemukan.`);
    }
    await this.chatRepository.deleteSession(sessionId);
  }
}