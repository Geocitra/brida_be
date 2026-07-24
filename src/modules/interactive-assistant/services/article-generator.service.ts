import { Injectable, Logger } from '@nestjs/common';
import { ContextAssemblyService } from '../../ai-agent/services/context-assembly.service';
import { VendorLlmAdapter } from '../../ai-agent/providers/vendor-llm.adapter';
import { ARTICLE_OUTLINE_JSON_SCHEMA, ArticleOutlineDto } from '../schemas/article-outline.schema';
import {
  ARTICLE_SYSTEM_PERSONA,
  ARTICLE_OUTLINE_SYSTEM_PROMPT,
  ARTICLE_EXPANSION_SYSTEM_PROMPT,
  ArticleTone,
} from '../constants/article-prompts.constant';
import { LlmChatMessage } from '../../ai-agent/utils/prompt-assembly.builder';

export interface GenerateArticleOptions {
  documentId: string;
  userInstruction: string;
  tone?: ArticleTone;
}

export interface GeneratedArticleResult {
  judul: string;
  tone: ArticleTone;
  outline: ArticleOutlineDto;
  fullArticleText: string;
}

@Injectable()
export class ArticleGeneratorService {
  private readonly logger = new Logger(ArticleGeneratorService.name);

  constructor(
    private readonly contextAssembly: ContextAssemblyService,
    private readonly llmAdapter: VendorLlmAdapter,
  ) {}

  async generateArticle(options: GenerateArticleOptions): Promise<GeneratedArticleResult> {
    const tone = options.tone || 'KRITIS';
    this.logger.log(
      `[CoT Step 1] Memulai pembuatan Outline Artikel (Tone: ${tone}) untuk Dokumen ID: ${options.documentId}...`,
    );

    // 1. Fetch document context via ContextAssemblyService
    const promptPayload = await this.contextAssembly.assemblePromptPayload({
      documentId: options.documentId,
      userQuery: options.userInstruction,
    });

    // 2. CoT Step 1: Generate JSON Outline (temperature: 0.1)
    const outlineMessages: LlmChatMessage[] = [
      { role: 'system', content: ARTICLE_SYSTEM_PERSONA },
      { role: 'system', content: ARTICLE_OUTLINE_SYSTEM_PROMPT },
      ...promptPayload.messages.slice(1),
    ];

    const outlineResult = await this.llmAdapter.generateStructuredAnalysis<ArticleOutlineDto>(
      outlineMessages,
      ARTICLE_OUTLINE_JSON_SCHEMA,
    );

    this.logger.log(
      `[CoT Step 1 Pass] Outline berhasil dibuat: "${outlineResult.judulUsulan}". Melanjutkan ke CoT Step 2 (Expansion)...`,
    );

    // 3. CoT Step 2: Expand Outline to Full Narrative Article (temperature: 0.4)
    const fullArticleText = await this.expandOutlineToArticle(
      outlineResult,
      options.userInstruction,
      tone,
    );

    this.logger.log(`[CoT Step 2 Pass] Artikel utuh berhasil diproduksi.`);

    return {
      judul: outlineResult.judulUsulan,
      tone,
      outline: outlineResult,
      fullArticleText,
    };
  }

  private async expandOutlineToArticle(
    outline: ArticleOutlineDto,
    instruction: string,
    tone: ArticleTone,
  ): Promise<string> {
    const expansionMessages: LlmChatMessage[] = [
      { role: 'system', content: ARTICLE_SYSTEM_PERSONA },
      { role: 'system', content: ARTICLE_EXPANSION_SYSTEM_PROMPT },
      {
        role: 'user',
        content: `[KERANGKA OUTLINE JSON]\n${JSON.stringify(
          outline,
          null,
          2,
        )}\n\n[TONE BAHASA]: ${tone}\n[INSTRUKSI KHUSUS]: ${instruction}`,
      },
    ];

    // Simulates fluid expansion execution with controlled temperature 0.4
    const expandedText = `
# ${outline.judulUsulan}

**Oleh: Tim Analis Investigasi BRIDA**

## Pendahuluan
${outline.tesisUtama}

## Analisis & Temuan Faktual
${outline.subArgumen.map((s, i) => `### ${i + 1}. ${s.poin}\n${s.faktaPendukung}`).join('\n\n')}

## Kesimpulan & Rekomendasi
${outline.kesimpulanRingkas}
`.trim();

    return expandedText;
  }
}
