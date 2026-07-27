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
 * Flexible Q&A response schema — accepts both investigative structured analysis
 * AND plain conversational answers, reducing schema mismatch errors.
 */
const QA_FLEXIBLE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    ringkasanEksekutif: {
      type: 'string',
      description: 'Jawaban utama atau ringkasan analitis terhadap pertanyaan pengguna.',
    },
    entitasTerlibat: {
      type: 'array',
      description: 'Daftar entitas, orang, instansi yang relevan (boleh kosong jika tidak ada).',
      items: {
        type: 'object',
        properties: {
          nama: { type: 'string' },
          peran: { type: 'string' },
          entitasTerkait: { type: 'string' },
        },
      },
    },
    kronologiPeristiwa: {
      type: 'array',
      description: 'Urutan fakta atau kronologi (boleh kosong jika tidak relevan).',
      items: {
        type: 'object',
        properties: {
          tanggal: { type: 'string' },
          deskripsi: { type: 'string' },
          lokasi: { type: 'string' },
        },
      },
    },
    indikasiPelanggaran: {
      type: 'array',
      description: 'Indikasi pelanggaran jika ada (boleh kosong untuk pertanyaan umum).',
      items: {
        type: 'object',
        properties: {
          jenis: { type: 'string' },
          pasalDugaan: { type: 'string' },
          rincian: { type: 'string' },
        },
      },
    },
    kesimpulanAnalisis: {
      type: 'string',
      description: 'Kesimpulan singkat atau penutup jawaban.',
    },
  },
  // No "required" constraint — all fields have fallback defaults in VendorLlmAdapter
};

@Injectable()
export class QaIntentHandler implements IIntentHandler {
  private readonly logger = new Logger(QaIntentHandler.name);

  constructor(
    private readonly sanitizer: PromptInjectionSanitizer,
    private readonly chatMemory: ChatMemoryService,
    private readonly contextAssembly: ContextAssemblyService,
    private readonly llmAdapter: VendorLlmAdapter,
  ) {}

  getIntentType(): IntentType {
    return 'ANALYTICAL_QA';
  }

  canHandle(query: string): boolean {
    return true; // Default fallback for analytical Q&A
  }

  async execute(payload: IntentExecutionPayload): Promise<any> {
    this.logger.log(
      `[QaIntentHandler] Memproses Q&A Analitik untuk Sesi ID: ${payload.sessionId}...`,
    );

    // 1. Prompt Injection Security Sanitization
    const sanitizedQuery = this.sanitizer.sanitize(payload.query);

    // 2. Record User Message in Chat Session
    await this.chatMemory.recordUserMessage(payload.sessionId, sanitizedQuery);

    // 3. Fetch Active Sliding Window Memory (Pruned 2,000 Token Limit)
    const memory = await this.chatMemory.getActiveSlidingWindowMemory(payload.sessionId);

    // Format chat history for Prompt Assembly
    const historyMessages: LlmChatMessage[] = memory.activeMessages.map((m) => ({
      role: m.role === 'USER' ? 'user' : 'assistant',
      content: m.content,
    }));

    // 4. Assemble Composite Quad-Block Prompt Payload
    const promptPayload = await this.contextAssembly.assemblePromptPayload({
      documentId: memory.documentId,
      documentIds: memory.documentIds,
      userQuery: sanitizedQuery,
    });

    // Inject history messages into prompt
    promptPayload.messages.splice(2, 0, ...historyMessages);

    // 5. Execute LLM with flexible schema (no required fields — tolerant normalization handles fallbacks)
    const analysisResult = await this.llmAdapter.generateStructuredAnalysis(
      promptPayload.messages,
      QA_FLEXIBLE_JSON_SCHEMA,
    );

    // 6. Persist Assistant Response in ChatSession
    const assistantResponseContent = JSON.stringify(analysisResult);
    await this.chatMemory.recordAssistantMessage(payload.sessionId, assistantResponseContent);

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
}
