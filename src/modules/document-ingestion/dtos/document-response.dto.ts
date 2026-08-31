export interface DocumentResponseDto {
  id: string;
  title: string;
  fileUrl: string;
  mimeType: string;
  checksumHash: string;
  status: string;
  createdAt: Date;
  metadata?: {
    fileSizeBytes: string;
    pageCount: number;
    totalTokenCount: number;
    category: string;
    uploadedBy: string;
    docType?: string;
    sourceUrl?: string;
    categoryId?: string;
    categoryName?: string;
    analyticalRole?: string;
    opdId?: string;
    opdName?: string;
  };
  chunkCount?: number;
  extractedLocationsCount?: number;
  chunks?: {
    chunkIndex: number;
    rawText: string;
    tokenCount: number;
  }[];
}

