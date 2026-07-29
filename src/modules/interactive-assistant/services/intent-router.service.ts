import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { IIntentHandler, IntentExecutionPayload } from '../interfaces/intent-handler.interface';
import { QaIntentHandler } from '../handlers/qa-intent.handler';
import { ArticleIntentHandler } from '../handlers/article-intent.handler';
import { ChatRepository } from '../repositories/chat.repository';
import { SessionType } from '@prisma/client';

@Injectable()
export class IntentRouterService {
  private readonly logger = new Logger(IntentRouterService.name);
  private readonly handlers: IIntentHandler[];

  constructor(
    private readonly articleHandler: ArticleIntentHandler,
    private readonly qaHandler: QaIntentHandler,
    private readonly chatRepository: ChatRepository,
  ) {
    // Registrasi handler berdasarkan prioritas evaluasi
    this.handlers = [this.articleHandler, this.qaHandler];
  }

  /**
   * Meng-upgrade tanda tangan metode (method signature) dispatch untuk mendukung multimodal attachments & draf aktif.
   * Menyinkronkan payload asisten dari Controller ke Handler yang dituju [5].
   */
  async dispatch(
    sessionId: string,
    query: string,
    attachments?: Array<{ fileId: string; classification?: 'BASELINE' | 'REALIZATION' | 'GENERAL_REFERENCE' }>,
    currentDraft?: string,
    districts?: string[],
  ): Promise<any> {
    if (!query || query.trim().length === 0) {
      throw new BadRequestException('Pesan atau kueri pengguna tidak boleh kosong.');
    }

    const session = await this.chatRepository.findSessionById(sessionId);
    if (!session) {
      throw new BadRequestException(`Sesi obrolan dengan ID '${sessionId}' tidak ditemukan.`);
    }

    const trimmedQuery = query.trim();

    // Rakit payload eksekusi instruksi lengkap untuk dikirim ke intent handler
    const payload: IntentExecutionPayload = {
      sessionId: session.id,
      documentId: session.documentId || undefined, // Fallback undefined jika Zero-Reference Mode aktif
      query: trimmedQuery,
      attachments,   // Injeksi ID berkas transien & screenshots baru [5]
      currentDraft,  // Injeksi draf naskah Markdown aktif dari editor visual [5]
      districts,     // Injeksi target filter daerah spasial baru
    };

    let defaultHandler: IIntentHandler = this.qaHandler;
    if (session.sessionType === SessionType.ARTICLE_GENERATOR) {
      defaultHandler = this.articleHandler;
    }

    let selectedHandler: IIntentHandler | null = null;
    let highestScore = 0.0;

    for (const handler of this.handlers) {
      const score = this.calculateConfidenceScore(handler, trimmedQuery, session.sessionType);

      if (score > highestScore) {
        highestScore = score;
        selectedHandler = handler;
      }
    }

    const MINIMUM_CONFIDENCE_THRESHOLD = 0.4;
    if (!selectedHandler || highestScore < MINIMUM_CONFIDENCE_THRESHOLD) {
      this.logger.log(
        `[IntentRouter] Skor keyakinan rendah (${highestScore.toFixed(2)}). Menggunakan default fallback handler untuk sesi ${session.sessionType}: [${defaultHandler.getIntentType()}]`,
      );
      selectedHandler = defaultHandler;
    }

    this.logger.log(
      `[IntentRouter] Kueri: "${trimmedQuery.slice(0, 45)}..." -> Rute Terpilih: [${selectedHandler.getIntentType()}] dengan skor keyakinan: ${highestScore.toFixed(2)}`,
    );

    return selectedHandler.execute(payload);
  }

  /**
   * Menghitung nilai keyakinan (Confidence Score) secara dinamis lintas handler.
   * Menggabungkan evaluasi leksikal ekspresi reguler dengan sensitivitas status sesi [1].
   */
  private calculateConfidenceScore(
    handler: IIntentHandler,
    query: string,
    currentSessionType: SessionType,
  ): number {
    const handlerType = handler.getIntentType();

    // Skenario A: Kueri mengandung kata kunci instruksi penulisan / drafting eksplisit
    const articleTriggersRegex =
      /(?:buatkan|tulis|susun|generate|draft|sintesis)\s*(?:artikel|opini|berita|press release|rilis media|publikasi|ringkasan eksekutif|draf)/i;
    const isArticleRequest = articleTriggersRegex.test(query);

    if (handlerType === 'ARTICLE_GENERATION') {
      if (isArticleRequest) {
        return 1.0; // Skor maksimal jika pengguna meminta draf rilis secara eksplisit
      }
      if (currentSessionType === SessionType.ARTICLE_GENERATOR) {
        return 0.8; // Skor tinggi jika berada di dalam ruang kerja penyusunan artikel
      }
      return 0.1; // Skor sangat rendah jika di luar ruang kerja artikel
    }

    if (handlerType === 'ANALYTICAL_QA') {
      if (isArticleRequest) {
        return 0.2; // Kurangi prioritas tanya-jawab jika pengguna ingin beralih membuat dokumen [4]
      }
      if (currentSessionType === SessionType.QA_CHAT) {
        return 0.9; // Prioritas tinggi untuk tanya-jawab umum di ruang diskusi
      }
      return 0.5; // Skor penyeimbang
    }

    // Fallback lama (backward compatibility) jika handler hanya memiliki canHandle
    if (typeof handler.canHandle === 'function' && handler.canHandle(query)) {
      return 0.6;
    }

    return 0.0;
  }
}