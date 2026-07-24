import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { ChatSession, ChatMessage, MessageRole } from '@prisma/client';

export interface AddMessageInput {
  sessionId: string;
  role: MessageRole;
  content: string;
  tokenCount: number;
}

@Injectable()
export class ChatRepository {
  private readonly logger = new Logger(ChatRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  async createSession(documentId: string, title?: string): Promise<ChatSession> {
    return this.prisma.chatSession.create({
      data: {
        documentId,
        title: title || 'Sesi Analisis Kasus',
      },
    });
  }

  async findSessionById(sessionId: string): Promise<ChatSession | null> {
    return this.prisma.chatSession.findUnique({
      where: { id: sessionId },
      include: { document: true },
    });
  }

  async findSessionsByDocument(documentId: string): Promise<ChatSession[]> {
    return this.prisma.chatSession.findMany({
      where: { documentId },
      orderBy: { updatedAt: 'desc' },
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
