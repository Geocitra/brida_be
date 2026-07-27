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
  ) { }

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

    // Liskov Substitution: Kedua strategi mengembalikan data bertipe Promise<string> yang identik
    if (totalTokens < DYNAMIC_CONTEXT_TOKEN_THRESHOLD) {
      contextPayloadText = await this.executeFullDocumentStuffingStrategy(validDocs, totalTokens);
    } else {
      contextPayloadText = await this.executeDynamicRagStrategy(
        validDocs,
        totalTokens,
        userQuery,
        topK,
        similarityThreshold,
      );
    }

    // 3. Rakit Prompt Composite Quad-Block
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

  /**
   * Strategi A: Memuat seluruh isi dokumen ke dalam prompt payload.
   * Digunakan apabila ukuran kumulatif dokumen masih berada di bawah ambang batas aman token (< 80,000).
   */
  private async executeFullDocumentStuffingStrategy(
    validDocs: any[],
    totalTokens: number,
  ): Promise<string> {
    this.logger.log(
      `[Hybrid Strategy A - Stuffed] Total tokens (${totalTokens}) < ${DYNAMIC_CONTEXT_TOKEN_THRESHOLD}. Menggunakan Full-Document Stuffing untuk ${validDocs.length} dokumen.`,
    );

    const allChunksText: string[] = [];
    validDocs.forEach((doc) => {
      if (doc.chunks && doc.chunks.length > 0) {
        allChunksText.push(`=== DOKUMEN: ${doc.title} ===\n` + doc.chunks.map((c: any) => c.rawText).join('\n\n'));
      }
    });

    return allChunksText.join('\n\n');
  }

  /**
   * Strategi B: Melakukan RAG Dinamis lintas dokumen acuan.
   * Menerapkan logika Dynamic Semantic Swapping untuk menyaring sampah konteks [4].
   */
  private async executeDynamicRagStrategy(
    validDocs: any[],
    totalTokens: number,
    userQuery: string,
    topK: number,
    similarityThreshold: number,
  ): Promise<string> {
    this.logger.log(
      `[Hybrid Strategy B - Dynamic RAG] Total tokens (${totalTokens}) >= ${DYNAMIC_CONTEXT_TOKEN_THRESHOLD}. Mengevaluasi kedekatan semantik kueri...`,
    );

    // 1. Eksekusi pencarian relevansi semantik lintas seluruh dokumen aktif secara paralel
    const retrievalTasks = validDocs.map((doc) =>
      this.vectorRetrieval.searchRelevantChunks({
        documentId: doc.id,
        queryText: userQuery,
        topK,
        similarityThreshold,
      }).catch((err) => {
        this.logger.warn(
          `Gagal mengambil chunks semantik untuk Dokumen ID '${doc.id}': ${err.message}`,
        );
        return [];
      }),
    );

    const allResultsList = await Promise.all(retrievalTasks);
    const combinedFlatResults = allResultsList.flat();

    // 2. Logika Dynamic Semantic Swapping & Pruning [4]
    // Chunks dengan skor di bawah threshold dibuang (Swapped Out)
    const highlyRelevantResults = combinedFlatResults
      .filter((chunk) => chunk.similarityScore >= similarityThreshold)
      .sort((a, b) => b.similarityScore - a.similarityScore)
      .slice(0, topK);

    const swappedOutCount = combinedFlatResults.length - highlyRelevantResults.length;

    this.logger.log(
      `[Dynamic Semantic Swapping] Selesai menyaring konteks. ${highlyRelevantResults.length} chunks relevan dimasukkan (SWAPPED IN), ${swappedOutCount} chunks sampah semantik dibuang (SWAPPED OUT) dari prompt payload [4].`,
    );

    if (highlyRelevantResults.length > 0) {
      return highlyRelevantResults
        .map(
          (item, idx) =>
            `--- CHUNK ${idx + 1} (Dokumen: ${item.documentId}, Indeks: ${item.chunkIndex
            }, Skor Semantik: ${item.similarityScore.toFixed(3)}) ---\n${item.rawText}`,
        )
        .join('\n\n');
    }

    return 'Konteks dokumen rujukan yang relevan dengan topik pertanyaan tidak ditemukan.';
  }
}