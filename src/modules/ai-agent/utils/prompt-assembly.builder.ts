import { Injectable, Logger } from '@nestjs/common';
import {
  BRIDA_SYSTEM_PERSONA,
  BRIDA_GUARDRAIL_POSTFIX,
} from '../constants/system-prompts.constant';

export interface LlmChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface QuadBlockPromptPayload {
  messages: LlmChatMessage[];
  systemBlock: string;
  contextBlock: string;
  userQueryBlock: string;
  postfixGuardrailBlock: string;
}

@Injectable()
export class PromptAssemblyBuilder {
  private readonly logger = new Logger(PromptAssemblyBuilder.name);

  private systemPersona: string = BRIDA_SYSTEM_PERSONA;
  private contextPayload: string = '';
  private memoryMessages: LlmChatMessage[] = [];
  private userQuery: string = '';
  private guardrailPostfix: string = BRIDA_GUARDRAIL_POSTFIX;

  reset(): this {
    this.systemPersona = BRIDA_SYSTEM_PERSONA;
    this.contextPayload = '';
    this.memoryMessages = [];
    this.userQuery = '';
    this.guardrailPostfix = BRIDA_GUARDRAIL_POSTFIX;
    return this;
  }

  setSystemPersona(customPersona?: string): this {
    if (customPersona && customPersona.trim().length > 0) {
      this.systemPersona = customPersona.trim();
    }
    return this;
  }

  setContextPayload(contextText: string): this {
    this.contextPayload = contextText ? contextText.trim() : '';
    return this;
  }

  setMemoryMessages(chatHistory: LlmChatMessage[]): this {
    this.memoryMessages = chatHistory || [];
    return this;
  }

  setUserQuery(query: string): this {
    this.userQuery = query ? query.trim() : '';
    return this;
  }

  setGuardrailPostfix(customPostfix?: string): this {
    if (customPostfix && customPostfix.trim().length > 0) {
      this.guardrailPostfix = customPostfix.trim();
    }
    return this;
  }

  build(): QuadBlockPromptPayload {
    const formattedContext = `[DOKUMEN TERLAMPIR - RUANG KONTEKS STATIS]\n${this.contextPayload}`;
    const formattedUserQuery = `[PERTANYAAN / INSTRUKSI PENGGUNA]\n${this.userQuery}`;

    // Construct Composite Message Array
    const messages: LlmChatMessage[] = [
      // Block 1: System Persona & Zero Knowledge (Cacheable)
      { role: 'system', content: this.systemPersona },
      // Block 2: Static Document Context (Cacheable)
      { role: 'system', content: formattedContext },
      // Composite Conversational Memory Messages (Sliding Window)
      ...this.memoryMessages,
      // Block 3: Volatile User Query
      { role: 'user', content: formattedUserQuery },
      // Block 4: Static Post-fix Recency Bias Guardrail
      { role: 'user', content: this.guardrailPostfix },
    ];

    this.logger.log(
      `[PromptAssemblyBuilder] Berhasil merakit Composite Quad-Block Payload (${messages.length} total messages).`,
    );

    return {
      messages,
      systemBlock: this.systemPersona,
      contextBlock: formattedContext,
      userQueryBlock: formattedUserQuery,
      postfixGuardrailBlock: this.guardrailPostfix,
    };
  }
}
