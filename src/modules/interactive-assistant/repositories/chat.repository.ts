import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ChatSession, ChatMessage, MessageRole, SessionType, ArticleLength, InteractionType } from '@prisma/client';

export interface AddMessageWithAttachmentsInput {
  sessionId: string;
  role: MessageRole;
  content: string;
  tokenCount: number;
  interactionType?: InteractionType;
  attachments?: Array<{
    fileUrl: string;
    fileName: string;
    mimeType: string;
    fileSizeBytes: bigint;
  }>;
}

export interface CreateArticleSessionInput {
  documentIds: string[];
  articleTitle: string;
  targetLength?: ArticleLength;
  tone?: string;
  initialPrompt?: string;
  parentSessionId?: string; // Menambahkan relasi ke sesi QA asal
}

@Injectable()
export class ChatRepository {
  private readonly logger = new Logger(ChatRepository.name);

  constructor(private readonly prisma: PrismaService) { }

  /**
   * Membuat sesi obrolan Q&A baru
   */
  async createSession(documentIds: string[], title?: string): Promise<ChatSession> {
    const primaryDocId = documentIds.length > 0 ? documentIds[0] : null;
    return this.prisma.chatSession.create({
      data: {
        documentId: primaryDocId,
        sessionType: SessionType.QA_CHAT,
        title: title || 'Sesi Analisis Kasus',
        sources: {
          create: documentIds.map((docId) => ({
            document: { connect: { id: docId } },
          })),
        },
      },
    });
  }

  /**
   * Membuat sesi generator naskah artikel baru (CoT)
   */
  async createArticleSession(input: CreateArticleSessionInput): Promise<any> {
    const {
      documentIds,
      articleTitle,
      targetLength = ArticleLength.MEDIUM,
      tone = 'solutif',
      parentSessionId
    } = input;

    return this.prisma.chatSession.create({
      data: {
        sessionType: SessionType.ARTICLE_GENERATOR,
        title: articleTitle || 'Draf Artikel Publikasi',
        articleTitle,
        targetLength,
        tone,
        parentSessionId: parentSessionId || null, // Merekam referensi sesi QA asal
        documentId: documentIds.length > 0 ? documentIds[0] : null,
        sources: {
          create: documentIds.map((docId) => ({
            document: { connect: { id: docId } },
          })),
        },
      },
      include: {
        sources: {
          include: {
            document: true,
          },
        },
        messages: {
          orderBy: { createdAt: 'asc' },
          include: {
            attachments: true,
          },
        },
      },
    });
  }

  /**
   * Mengambil detail sesi obrolan lengkap berdasarkan ID
   */
  async findSessionById(sessionId: string): Promise<any | null> {
    return this.prisma.chatSession.findUnique({
      where: { id: sessionId },
      include: {
        document: true,
        sources: {
          include: {
            document: {
              include: {
                metadata: true,
              },
            },
          },
        },
        messages: {
          orderBy: { createdAt: 'asc' },
          include: {
            attachments: true,
          },
        },
      },
    });
  }

  async findSessionsByDocument(documentId: string): Promise<ChatSession[]> {
    return this.prisma.chatSession.findMany({
      where: { documentId },
      orderBy: { updatedAt: 'desc' },
    });
  }

  /**
   * Menarik seluruh sesi penulisan artikel tersimpan
   */
  async findArticleSessions(): Promise<any[]> {
    return this.prisma.chatSession.findMany({
      where: {
        sessionType: SessionType.ARTICLE_GENERATOR,
      },
      orderBy: { updatedAt: 'desc' },
      include: {
        sources: {
          include: {
            document: true,
          },
        },
        messages: {
          orderBy: { createdAt: 'asc' },
          include: {
            attachments: true,
          },
        },
      },
    });
  }

  /**
   * Menarik seluruh sesi tanya-jawab interaktif terdaftar
   */
  async findQaSessions(): Promise<any[]> {
    return this.prisma.chatSession.findMany({
      where: {
        sessionType: SessionType.QA_CHAT,
      },
      orderBy: { updatedAt: 'desc' },
      include: {
        document: true,
        sources: {
          include: {
            document: true,
          },
        },
        messages: {
          orderBy: { createdAt: 'asc' },
          include: {
            attachments: true,
          },
        },
      },
    });
  }

  /**
   * Menyimpan pesan baru ke dalam database secara transaksional bersenang (Atomic Commit).
   * Mampu menangani pembuatan pesan sekaligus metadata lampiran berkas/screenshots.
   */
  async addMessage(input: AddMessageWithAttachmentsInput): Promise<ChatMessage> {
    const { sessionId, role, content, tokenCount, interactionType = InteractionType.MANUAL_INPUT, attachments = [] } = input;

    const message = await this.prisma.chatMessage.create({
      data: {
        sessionId,
        role,
        content,
        tokenCount,
        interactionType,
        attachments: {
          create: attachments.map((att) => ({
            fileUrl: att.fileUrl,
            fileName: att.fileName,
            mimeType: att.mimeType,
            fileSizeBytes: att.fileSizeBytes,
          })),
        },
      },
      include: {
        attachments: true,
      },
    });

    // Touch timestamp perbaruan sesi obrolan
    await this.prisma.chatSession.update({
      where: { id: sessionId },
      data: { updatedAt: new Date() },
    });

    return message;
  }

  /**
   * Ingestion Bypass: Menautkan referensi dokumen acuan baru yang diunggah dari chat secara dinamis
   */
  async linkDocumentSource(sessionId: string, documentId: string): Promise<any> {
    return this.prisma.chatSessionSourceRef.upsert({
      where: {
        sessionId_documentId: {
          sessionId,
          documentId,
        },
      },
      update: {}, // Jika relasi penautan sudah terdaftar, biarkan tidak berubah
      create: {
        sessionId,
        documentId,
      },
    });
  }

  /**
   * Menyinkronkan daftar dokumen acuan terpilih untuk sesi aktif (Zero-Reference vs Multi-Reference)
   */
  async syncSessionDocuments(sessionId: string, documentIds: string[]): Promise<void> {
    const primaryDocId = documentIds.length > 0 ? documentIds[0] : null;

    // 1. Update primary documentId
    await this.prisma.chatSession.update({
      where: { id: sessionId },
      data: {
        documentId: primaryDocId,
      },
    });

    // 2. Hapus relasi lama
    await this.prisma.chatSessionSourceRef.deleteMany({
      where: { sessionId },
    });

    // 3. Masukkan relasi baru
    if (documentIds.length > 0) {
      await this.prisma.chatSessionSourceRef.createMany({
        data: documentIds.map((docId) => ({
          sessionId,
          documentId: docId,
        })),
      });
    }

    this.logger.log(`[Sync Session Sources] Sesi ID: ${sessionId} -> Berhasil disinkronkan ke ${documentIds.length} dokumen.`);
  }

  /**
   * Memperbarui draf teks Markdown naskah artikel aktif (Pane Kanan)
   */
  async updateActiveDraft(sessionId: string, currentDraft: string): Promise<ChatSession> {
    return this.prisma.chatSession.update({
      where: { id: sessionId },
      data: {
        currentDraft,
        updatedAt: new Date(),
      },
    });
  }

  async deleteSession(sessionId: string): Promise<ChatSession> {
    return this.prisma.chatSession.delete({
      where: { id: sessionId },
    });
  }

  async updateSessionSummary(sessionId: string, summary: string): Promise<ChatSession> {
    return this.prisma.chatSession.update({
      where: { id: sessionId },
      data: {
        runningSummary: summary,
        updatedAt: new Date(),
      },
    });
  }

  /**
   * Mengambil kumpulan pesan terbaru terbatas untuk operasi sliding window memory
   */
  async getLatestMessages(sessionId: string, fetchLimit: number = 30): Promise<ChatMessage[]> {
    return this.prisma.chatMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'desc' },
      take: fetchLimit,
      include: {
        attachments: true,
      },
    });
  }

  /**
   * Mengambil seluruh pesan chat secara kronologis tanpa batasan sliding window
   */
  async getAllMessagesChronological(sessionId: string): Promise<ChatMessage[]> {
    return this.prisma.chatMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
      include: {
        attachments: true,
      },
    });
  }

  /**
   * Memperbarui judul artikel (articleTitle) pada sesi percakapan
   */
  async updateArticleMetadata(sessionId: string, articleTitle: string): Promise<void> {
    await this.prisma.chatSession.update({
      where: { id: sessionId },
      data: {
        articleTitle,
        title: articleTitle,
        updatedAt: new Date(),
      },
    });
  }

  /**
   * Memperbarui metadata gaya bahasa (tone) dan target panjang artikel (targetLength) pada sesi aktif
   */
  async updateSessionMetadata(sessionId: string, tone?: string, targetLength?: string): Promise<void> {
    const data: any = {};
    if (tone) data.tone = tone;
    if (targetLength) data.targetLength = targetLength;

    if (Object.keys(data).length > 0) {
      await this.prisma.chatSession.update({
        where: { id: sessionId },
        data,
      });
      this.logger.log(`[Update Session Metadata] Sesi ID: ${sessionId} -> Tone: ${tone}, Length: ${targetLength}`);
    }
  }
}