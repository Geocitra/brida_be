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
  };
  chunkCount?: number;
  extractedLocationsCount?: number;
}
