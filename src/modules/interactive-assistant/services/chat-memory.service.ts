import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ChatRepository } from '../repositories/chat.repository';
import { TokenEstimatorUtil } from '../../ai-agent/utils/token-estimator.util';
import { ActiveChatMessage, SlidingWindowMemoryPayload } from '../interfaces/chat-memory.interface';
import { MessageRole } from '@prisma/client';

@Injectable()
export class ChatMemoryService {
  private readonly logger = new Logger(ChatMemoryService.name);

  // Maximum cumulative tokens allowed for conversational context window (~2,000 tokens)
  private readonly MAX_MEMORY_TOKENS = 2000;
  private readonly MAX_MESSAGES_COUNT = 10; // 5 interaction turns (user + assistant)

  constructor(
    private readonly chatRepository: ChatRepository,
    private readonly tokenEstimator: TokenEstimatorUtil,
  ) {}

  async createSession(documentId: string, title?: string) {
    return this.chatRepository.createSession(documentId, title);
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

  /**
   * Sliding Window Algorithm with Token Truncation
   */
  async getActiveSlidingWindowMemory(sessionId: string): Promise<SlidingWindowMemoryPayload> {
    const session = await this.chatRepository.findSessionById(sessionId);
    if (!session) {
      throw new NotFoundException(`Sesi obrolan dengan ID '${sessionId}' tidak ditemukan.`);
    }

    // 1. Fetch raw messages ordered newest first
    const rawMessages = await this.chatRepository.getLatestMessages(sessionId, 30);

    const selectedMessages: ActiveChatMessage[] = [];
    let accumulatedTokens = 0;
    let prunedCount = 0;

    // 2. Iterative sliding window: newest first until token limit or message count limit
    for (const msg of rawMessages) {
      const msgTokens = msg.tokenCount || this.tokenEstimator.estimateTokenCount(msg.content);

      if (
        accumulatedTokens + msgTokens <= this.MAX_MEMORY_TOKENS &&
        selectedMessages.length < this.MAX_MESSAGES_COUNT
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

    // 3. Reverse selected messages back to chronological order (asc)
    selectedMessages.reverse();

    this.logger.log(
      `[Sliding Window Memory] Sesi ID: ${sessionId} -> Dipilih ${selectedMessages.length} pesan aktif (${accumulatedTokens} tokens, Dipangkas ${prunedCount} pesan lama).`,
    );

    return {
      sessionId: session.id,
      documentId: session.documentId,
      activeMessages: selectedMessages,
      totalMemoryTokens: accumulatedTokens,
      prunedMessagesCount: prunedCount,
    };
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
