import { Injectable, Logger } from '@nestjs/common';
import { IEmbeddingProvider } from '../interfaces/embedding-provider.interface';
import { ChunkData } from '../interfaces/chunk-data.interface';

export interface ChunkWithEmbedding {
  chunkData: ChunkData;
  embedding: number[];
}

@Injectable()
export class EmbeddingBatchProcessor {
  private readonly logger = new Logger(EmbeddingBatchProcessor.name);
  private readonly batchSize = 50;

  async processInBatches(
    chunks: ChunkData[],
    embeddingProvider: IEmbeddingProvider,
  ): Promise<ChunkWithEmbedding[]> {
    if (!chunks || chunks.length === 0) {
      return [];
    }

    const results: ChunkWithEmbedding[] = [];
    const totalBatches = Math.ceil(chunks.length / this.batchSize);

    this.logger.log(
      `[EmbeddingBatchProcessor] Memulai pemrosesan ${chunks.length} chunks dalam ${totalBatches} batch (Max ${this.batchSize} chunks/batch)...`,
    );

    for (let i = 0; i < chunks.length; i += this.batchSize) {
      const batchChunks = chunks.slice(i, i + this.batchSize);
      const batchTexts = batchChunks.map((c) => c.rawText);

      const embeddings = await embeddingProvider.generateEmbeddings(batchTexts);

      for (let j = 0; j < batchChunks.length; j++) {
        results.push({
          chunkData: batchChunks[j],
          embedding: embeddings[j],
        });
      }

      const currentBatchNum = Math.floor(i / this.batchSize) + 1;
      this.logger.log(`[Batch ${currentBatchNum}/${totalBatches}] Selesai memproses ${batchChunks.length} chunks.`);
    }

    return results;
  }
}
