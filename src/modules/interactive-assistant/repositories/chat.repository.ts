import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ChatSession, ChatMessage, MessageRole, SessionType, ArticleLength } from '@prisma/client';

export interface AddMessageInput {
  sessionId: string;
  role: MessageRole;
  content: string;
  tokenCount: number;
}

export interface CreateArticleSessionInput {
  documentIds: string[];
  articleTitle: string;
  targetLength?: ArticleLength;
  tone?: string;
  initialPrompt?: string;
}

@Injectable()
export class ChatRepository {
  private readonly logger = new Logger(ChatRepository.name);

  constructor(private readonly prisma: PrismaService) {}

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

  async createArticleSession(input: CreateArticleSessionInput): Promise<any> {
    const { documentIds, articleTitle, targetLength = ArticleLength.MEDIUM, tone = 'solutif' } = input;

    return this.prisma.chatSession.create({
      data: {
        sessionType: SessionType.ARTICLE_GENERATOR,
        title: articleTitle || 'Draf Artikel Publikasi',
        articleTitle,
        targetLength,
        tone,
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
        },
      },
    });
  }

  async findSessionById(sessionId: string): Promise<any | null> {
    return this.prisma.chatSession.findUnique({
      where: { id: sessionId },
      include: {
        document: true,
        sources: {
          include: {
            document: true,
          },
        },
        messages: {
          orderBy: { createdAt: 'asc' },
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
        },
      },
    });
  }

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
        },
      },
    });
  }

  async addMessage(input: AddMessageInput): Promise<ChatMessage> {
    const message = await this.prisma.chatMessage.create({
      data: {
        sessionId: input.sessionId,
        role: input.role,
        content: input.content,
        tokenCount: input.tokenCount,
      },
    });

    // Touch session updatedAt timestamp
    await this.prisma.chatSession.update({
      where: { id: input.sessionId },
      data: { updatedAt: new Date() },
    });

    return message;
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
      } as any,
    });
  }

  /**
   * Fetches latest N messages ordered newest first for sliding window truncation
   */
  async getLatestMessages(sessionId: string, fetchLimit: number = 30): Promise<ChatMessage[]> {
    return this.prisma.chatMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'desc' },
      take: fetchLimit,
    });
  }
}
