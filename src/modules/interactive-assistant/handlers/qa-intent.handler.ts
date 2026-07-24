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
import { ANALYSIS_OUTPUT_JSON_SCHEMA } from '../../ai-agent/schemas/analysis-output.schema';
import { LlmChatMessage } from '../../ai-agent/utils/prompt-assembly.builder';

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

    // 1. Step 1: Prompt Injection Security Sanitization
    const sanitizedQuery = this.sanitizer.sanitize(payload.query);

    // 2. Step 2: Record User Message in Chat Session
    await this.chatMemory.recordUserMessage(payload.sessionId, sanitizedQuery);

    // 3. Step 3: Fetch Active Sliding Window Memory (Pruned 2,000 Token Limit)
    const memory = await this.chatMemory.getActiveSlidingWindowMemory(payload.sessionId);

    // Format chat history messages for Prompt Assembly
    const historyMessages: LlmChatMessage[] = memory.activeMessages.map((m) => ({
      role: m.role === 'USER' ? 'user' : 'assistant',
      content: m.content,
    }));

    // 4. Step 4: Assemble Composite Quad-Block Prompt Payload
    const promptPayload = await this.contextAssembly.assemblePromptPayload({
      documentId: memory.documentId,
      userQuery: sanitizedQuery,
    });

    // Inject history messages into prompt messages
    promptPayload.messages.splice(2, 0, ...historyMessages);

    // 5. Step 5: Execute LLM Adapter with temperature: 0.0 & JSON Schema Enforcement
    const analysisResult = await this.llmAdapter.generateStructuredAnalysis(
      promptPayload.messages,
      ANALYSIS_OUTPUT_JSON_SCHEMA,
    );

    // 6. Step 6: Persistence - Record Assistant Response in ChatSession
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
