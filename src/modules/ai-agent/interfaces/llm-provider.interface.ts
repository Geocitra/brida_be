import { LlmChatMessage } from '../utils/prompt-assembly.builder';

export interface ILlmProvider {
  /**
   * Returns vendor provider name (e.g. OpenAI / Anthropic / Gemini / Local)
   */
  getProviderName(): string;

  /**
   * Generates structured analysis conforming strictly to the provided JSON Schema
   */
  generateStructuredAnalysis<T>(
    messages: LlmChatMessage[],
    jsonSchema: any,
  ): Promise<T>;
}
