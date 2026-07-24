export interface ActiveChatMessage {
  id: string;
  role: 'USER' | 'ASSISTANT' | 'SYSTEM';
  content: string;
  tokenCount: number;
  createdAt: Date;
}

export interface SlidingWindowMemoryPayload {
  sessionId: string;
  documentId: string;
  activeMessages: ActiveChatMessage[];
  totalMemoryTokens: number;
  prunedMessagesCount: number;
}
