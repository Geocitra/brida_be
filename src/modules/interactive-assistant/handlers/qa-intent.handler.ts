import { Injectable, Logger } from '@nestjs/common';
import {
  IIntentHandler,
  IntentType,
  IntentExecutionPayload,
} from '../interfaces/intent-handler.interface';
import { ChatMemoryService } from '../services/chat-memory.service';
import { ContextAssemblyService } from '../../ai-agent/services/context-assembly.service';
import { VendorLlmAdapter } from '../../ai-agent/providers/vendor-llm.adapter';
import { PromptInjectionSanitizer } from '../utils/prompt-injection-sanitizer.util';
import { LlmChatMessage } from '../../ai-agent/utils/prompt-assembly.builder';

/**
 * Skema Respons Obrolan Generik & Fleksibel.
 * Membebaskan LLM menulis Markdown kaya di dalam 'answer' dan merekomendasikan 'suggestions'.
 */
const QA_CONVERSATIONAL_SCHEMA = {
  type: 'object',
  required: ['answer'],
  properties: {
    answer: {
      type: 'string',
      description:
        'The main conversational answer in Bahasa Indonesia. Format strictly using beautiful, rich Markdown (using headers ##, bold texts, bullet lists, and comparison tables if comparing data). Always embed structured citation anchors in the format [docId:chunkIndex] (e.g. [doc-001:2]) adjacent to any claims, metrics, or factual statements derived from the context chunks.',
    },
    suggestions: {
      type: 'array',
      items: { type: 'string' },
      description:
        'Generate exactly 3 highly relevant, contextual follow-up questions or discussion options to guide the user in continuing the conversation.',
    },
  },
};

@Injectable()
export class QaIntentHandler implements IIntentHandler {
  private readonly logger = new Logger(QaIntentHandler.name);

  constructor(
    private readonly sanitizer: PromptInjectionSanitizer,
    private readonly chatMemory: ChatMemoryService,
    private readonly contextAssembly: ContextAssemblyService,
    private readonly llmAdapter: VendorLlmAdapter,
  ) { }

  getIntentType(): IntentType {
    return 'ANALYTICAL_QA';
  }

  canHandle(query: string): boolean {
    return true; // Default fallback untuk seluruh obrolan umum & tanya jawab dokumen
  }

  async execute(payload: IntentExecutionPayload): Promise<any> {
    this.logger.log(
      `[QaIntentHandler] Memproses Q&A Analitik untuk Sesi ID: ${payload.sessionId}...`,
    );

    // 1. Sanitasi Keamanan dari Prompt Injection
    const sanitizedQuery = this.sanitizer.sanitize(payload.query);

    // 2. Rekam Pesan Pengguna ke Database
    await this.chatMemory.recordUserMessage(payload.sessionId, sanitizedQuery);

    // 3. Ambil Memori Jendela Aktif (Sliding Window & Running Summary) [1]
    const memory = await this.chatMemory.getActiveSlidingWindowMemory(payload.sessionId);

    // Format riwayat chat jangka pendek untuk Prompt Assembly
    const historyMessages: LlmChatMessage[] = memory.activeMessages.map((m) => ({
      role: m.role === 'USER' ? 'user' : 'assistant',
      content: m.content,
    }));

    // 4. Rakit Prompt Payload 4-Blok
    const promptPayload = await this.contextAssembly.assemblePromptPayload({
      documentId: memory.documentId,
      documentIds: memory.documentIds,
      userQuery: sanitizedQuery,
    });

    // Injeksi Riwayat Chat Jangka Pendek ke Prompt
    promptPayload.messages.splice(2, 0, ...historyMessages);

    // Injeksi Memori Jangka Panjang (Running Summary) jika tersedia [1, 2]
    if (memory.runningSummary) {
      promptPayload.messages.splice(1, 0, {
        role: 'system',
        content: `[RINGKASAN EPISODIK OBROLAN SEBELUMNYA]\nBerikut adalah ringkasan jalan percakapan sebelumnya untuk menjaga ingatan jangka panjang Anda: ${memory.runningSummary}`,
      });
    }

    // 5. Eksekusi LLM dengan Skema Percakapan Bebas [3]
    const analysisResult = await this.llmAdapter.generateStructuredAnalysis<{
      answer: string;
      suggestions?: string[];
    }>(promptPayload.messages, QA_CONVERSATIONAL_SCHEMA, 0.4);

    // 6. Persistensi Jawaban AI Asisten ke Database (Disimpan dalam bentuk JSON stringified)
    const assistantResponseContent = JSON.stringify(analysisResult);
    await this.chatMemory.recordAssistantMessage(payload.sessionId, assistantResponseContent);

    // 7. Penanganan Pemadatan Memori Latar Belakang (Asynchronous Compaction Guard) [1]
    if (
      this.chatMemory.shouldTriggerCompaction(
        memory.prunedMessagesCount,
        memory.totalMemoryTokens,
      )
    ) {
      this.triggerBackgroundCompaction(
        payload.sessionId,
        memory,
        analysisResult.answer,
      );
    }

    return {
      intent: this.getIntentType(),
      sessionId: payload.sessionId,
      documentId: memory.documentId,
      data: analysisResult,
      memoryInfo: {
        activeTokens: memory.totalMemoryTokens,
        prunedMessagesCount: memory.prunedMessagesCount,
      },
    };
  }

  /**
   * Proses Asinkron di Latar Belakang untuk Memperbarui Running Summary [1].
   * Berfungsi mereduksi riwayat chat menjadi ringkasan padat tanpa menyumbat respons utama ke klien.
   */
  private async triggerBackgroundCompaction(
    sessionId: string,
    memory: any,
    latestAnswer: string,
  ): Promise<void> {
    // Jalankan asinkron tanpa memblokir thread eksekusi utama
    Promise.resolve()
      .then(async () => {
        const previousSummary =
          memory.runningSummary || 'Belum ada riwayat pembicaraan sebelumnya.';
        const activeMessagesStr = memory.activeMessages
          .map((m: any) => `${m.role === 'USER' ? 'User' : 'Assistant'}: ${m.content}`)
          .join('\n');

        const compactionPrompt: LlmChatMessage[] = [
          {
            role: 'system',
            content: `Anda adalah asisten pencatat memori kognitif BRIDA Mimika. 
Tugas Anda: Perbarui [RINGKASAN EPISODIK OBROLAN] secara padat dan kronologis (maksimal 200 kata).
Gabungkan [RINGKASAN SEBELUMNYA] dengan [OBROLAN BARU] untuk menghasilkan ringkasan naratif baru yang komprehensif.
Hindari kalimat pembuka (intro), langsung tuliskan ringkasan faktualnya.`,
          },
          {
            role: 'user',
            content: `RINGKASAN SEBELUMNYA:\n${previousSummary}\n\nOBROLAN BARU:\n${activeMessagesStr}\nAssistant: ${latestAnswer}`,
          },
        ];

        const compactionSchema = {
          type: 'object',
          required: ['summary'],
          properties: {
            summary: {
              type: 'string',
              description: 'Ringkasan baru hasil konsolidasi riwayat obrolan.',
            },
          },
        };

        const result = await this.llmAdapter.generateStructuredAnalysis<{
          summary: string;
        }>(compactionPrompt, compactionSchema, 0.0);

        if (result?.summary) {
          await this.chatMemory.updateRunningSummary(sessionId, result.summary);
          this.logger.log(
            `[Compaction Guard] Berhasil memperbarui Running Summary untuk Sesi ID: ${sessionId}`,
          );
        }
      })
      .catch((err) => {
        this.logger.error(
          `[Compaction Guard Error] Gagal memproses pemadatan memori di latar belakang: ${err.message}`,
        );
      });
  }
}