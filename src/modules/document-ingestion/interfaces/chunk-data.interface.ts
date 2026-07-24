export interface ChunkSpatialMetadata {
  startCharIndex: number;
  endCharIndex: number;
  estimatedPage?: number;
  overlapWithPrevious: boolean;
}

export interface ChunkData {
  chunkIndex: number;
  rawText: string;
  tokenCount: number;
  spatialMetadata: ChunkSpatialMetadata;
  overlapText?: string;
}
