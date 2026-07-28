export interface ActiveChatMessage {
  id: string;
  role: 'USER' | 'ASSISTANT' | 'SYSTEM';
  content: string;
  tokenCount: number;
  createdAt: Date;
}

// Perbarui struktur ini agar mengamankan properti metadata artikel dari sesi
export interface SlidingWindowMemoryPayload {
  sessionId: string;
  documentId: string | null; // Nullable untuk menampung Zero-Reference
  documentIds?: string[];
  activeMessages: ActiveChatMessage[];
  totalMemoryTokens: number;
  prunedMessagesCount: number;

  // Penambahan metadata state rilis naskah
  title?: string;
  articleTitle?: string | null;
  tone?: string | null;
  targetLength?: string | null;
}

// Definisikan HierarchicalMemoryPayload secara terpusat di berkas interface ini (Best Practice)
export interface HierarchicalMemoryPayload extends SlidingWindowMemoryPayload {
  runningSummary?: string | null;
}