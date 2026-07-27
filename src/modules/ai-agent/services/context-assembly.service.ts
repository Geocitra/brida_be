import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DocumentRepository } from '../../document-ingestion/repositories/document.repository';
import { VectorRetrievalService } from './vector-retrieval.service';
import { TokenEstimatorUtil } from '../utils/token-estimator.util';
import { PromptAssemblyBuilder, QuadBlockPromptPayload } from '../utils/prompt-assembly.builder';
import { DYNAMIC_CONTEXT_TOKEN_THRESHOLD } from '../constants/system-prompts.constant';

export interface AssemblePromptOptions {
  documentId?: string;
  documentIds?: string[];
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
    const { documentId, documentIds = [], userQuery, topK = 10, similarityThreshold = 0.5 } = options;

    const targetDocIds = documentIds.length > 0 ? documentIds : (documentId ? [documentId] : []);
    const docs = await Promise.all(targetDocIds.map(id => this.repository.findById(id)));
    const validDocs = docs.filter((d): d is NonNullable<typeof d> => d !== null && d !== undefined);

    if (validDocs.length === 0) {
      throw new NotFoundException(`Dokumen acuan untuk kueri tidak ditemukan.`);
    }

    const totalTokens = validDocs.reduce((acc, doc) => acc + (doc.metadata?.totalTokenCount || 0), 0);
    let contextPayloadText = '';

    // 2. Hybrid Context-Aware Retrieval Decision
    if (totalTokens < DYNAMIC_CONTEXT_TOKEN_THRESHOLD) {
      // Strategy A: Full-Document Stuffing (< 80,000 tokens) -> Stuff all selected docs
      this.logger.log(
        `[Hybrid Strategy A] Total tokens (${totalTokens}) < ${DYNAMIC_CONTEXT_TOKEN_THRESHOLD}. Menggunakan Full-Document Stuffing untuk ${validDocs.length} dokumen.`,
      );
      const allChunksText: string[] = [];
      validDocs.forEach((doc) => {
        if (doc.chunks && doc.chunks.length > 0) {
          allChunksText.push(`=== DOKUMEN: ${doc.title} ===\n` + doc.chunks.map((c) => c.rawText).join('\n\n'));
        }
      });
      contextPayloadText = allChunksText.join('\n\n');
    } else {
      // Strategy B: Vector Retrieval (>= 80,000 tokens) -> Retrieves Top-K chunks via pgvector across all selected docs
      this.logger.log(
        `[Hybrid Strategy B] Total tokens (${totalTokens}) >= ${DYNAMIC_CONTEXT_TOKEN_THRESHOLD}. Menggunakan Vector Retrieval lintas ${validDocs.length} dokumen.`,
      );
      const allResultsList = await Promise.all(
        validDocs.map((doc) =>
          this.vectorRetrieval.searchRelevantChunks({
            documentId: doc.id,
            queryText: userQuery,
            topK,
            similarityThreshold,
          })
        )
      );

      const combinedResults = allResultsList
        .flat()
        .sort((a, b) => b.similarityScore - a.similarityScore)
        .slice(0, topK);

      if (combinedResults.length > 0) {
        contextPayloadText = combinedResults
          .map(
            (item, idx) =>
              `--- CHUNK ${idx + 1} (Dokumen ID: ${item.documentId}, Score: ${item.similarityScore.toFixed(3)}) ---\n${item.rawText}`,
          )
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
