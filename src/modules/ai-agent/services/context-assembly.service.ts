import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DocumentRepository } from '../../document-ingestion/repositories/document.repository';
import { VectorRetrievalService } from './vector-retrieval.service';
import { TokenEstimatorUtil } from '../utils/token-estimator.util';
import { PromptAssemblyBuilder, QuadBlockPromptPayload } from '../utils/prompt-assembly.builder';
import { DYNAMIC_CONTEXT_TOKEN_THRESHOLD } from '../constants/system-prompts.constant';

export interface AssemblePromptOptions {
  documentId: string;
  userQuery: string;
  topK?: number;
  similarityThreshold?: number;
}

@Injectable()
export class ContextAssemblyService {
  private readonly logger = new Logger(ContextAssemblyService.name);

  constructor(
    private readonly repository: DocumentRepository,
    private readonly vectorRetrieval: VectorRetrievalService,
    private readonly tokenEstimator: TokenEstimatorUtil,
    private readonly promptBuilder: PromptAssemblyBuilder,
  ) {}

  async assemblePromptPayload(options: AssemblePromptOptions): Promise<QuadBlockPromptPayload> {
    const { documentId, userQuery, topK = 10, similarityThreshold = 0.5 } = options;

    // 1. Fetch document and metadata
    const doc = await this.repository.findById(documentId);
    if (!doc) {
      throw new NotFoundException(`Dokumen laporan dengan ID '${documentId}' tidak ditemukan.`);
    }

    const totalTokens = doc.metadata?.totalTokenCount || 0;
    let contextPayloadText = '';

    // 2. Hybrid Context-Aware Retrieval Decision
    if (totalTokens < DYNAMIC_CONTEXT_TOKEN_THRESHOLD && doc.chunks && doc.chunks.length > 0) {
      // Strategy A: Full-Document Stuffing (< 80,000 tokens) -> Maximizes Prompt Caching Hit Rate
      this.logger.log(
        `[Hybrid Strategy A] Total tokens (${totalTokens}) < ${DYNAMIC_CONTEXT_TOKEN_THRESHOLD}. Menggunakan Full-Document Stuffing untuk Prompt Caching.`,
      );
      contextPayloadText = doc.chunks.map((c) => c.rawText).join('\n\n');
    } else {
      // Strategy B: Vector Retrieval (>= 80,000 tokens) -> Retrieves Top-K chunks via pgvector
      this.logger.log(
        `[Hybrid Strategy B] Total tokens (${totalTokens}) >= ${DYNAMIC_CONTEXT_TOKEN_THRESHOLD}. Menggunakan Vector Retrieval (pgvector Top-${topK}).`,
      );
      const retrievedChunks = await this.vectorRetrieval.searchRelevantChunks({
        documentId,
        queryText: userQuery,
        topK,
        similarityThreshold,
      });

      if (retrievedChunks.length > 0) {
        contextPayloadText = retrievedChunks
          .map((item, idx) => `--- CHUNK ${idx + 1} (Score: ${item.similarityScore.toFixed(3)}) ---\n${item.rawText}`)
          .join('\n\n');
      } else {
        contextPayloadText = 'Teks relevan tidak ditemukan pada dokumen.';
      }
    }

    // 3. Creational Builder Pattern Assembly (Quad-Block Prompt)
    const payload = this.promptBuilder
      .reset()
      .setContextPayload(contextPayloadText)
      .setUserQuery(userQuery)
      .build();

    const estimatedTotalTokens = this.tokenEstimator.estimateArrayTokenCount(
      payload.messages.map((m) => m.content),
    );

    this.logger.log(
      `[ContextAssemblyService] Payload 4-Blok berhasil dirakit (Est. Total Payload Tokens: ${estimatedTotalTokens}).`,
    );

    return payload;
  }
}
