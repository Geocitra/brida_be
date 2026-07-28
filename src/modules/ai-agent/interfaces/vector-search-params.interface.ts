export interface VectorSearchParams {
  documentId: string;
  queryVector: number[];
  limit?: number;
  similarityThreshold?: number; // 0.0 to 1.0 (default e.g. 0.50)
  queryText?: string;
}
