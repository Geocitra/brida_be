import { ChunkSpatialMetadata } from '../../document-ingestion/interfaces/chunk-data.interface';

export interface RetrievalResult {
  chunkId: string;
  documentId: string;
  chunkIndex: number;
  rawText: string;
  tokenCount: number;
  similarityScore: number; // 0.0 to 1.0 (Cosine Similarity)
  spatialMetadata?: ChunkSpatialMetadata;
}
