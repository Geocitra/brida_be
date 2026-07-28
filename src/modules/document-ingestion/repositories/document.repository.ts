import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { Prisma, DocumentStatus, LogStatus, ReportDocument } from '@prisma/client';
import { ChunkData } from '../interfaces/chunk-data.interface';
import { ExtractedGeospatialData } from '../services/geospatial-parser.service';
import { VectorSearchParams } from '../../ai-agent/interfaces/vector-search-params.interface';
import { RetrievalResult } from '../../ai-agent/interfaces/retrieval-result.interface';

export interface ChunkWithVectorInput {
  chunkData: ChunkData;
  embedding: number[];
  locations: ExtractedGeospatialData[];
}

export interface CreateDocumentTransactionInput {
  title: string;
  fileUrl: string;
  mimeType: string;
  checksumHash: string;
  fileSizeBytes: bigint;
  pageCount: number;
  totalTokenCount: number;
  category: string;
  uploadedBy: string;
  docType?: string;
  chunks: ChunkWithVectorInput[];
  executionTimeMs: number;
}

@Injectable()
export class DocumentRepository {
  private readonly logger = new Logger(DocumentRepository.name);

  constructor(private readonly prisma: PrismaService) {}

  async findByChecksum(checksumHash: string): Promise<ReportDocument | null> {
    return this.prisma.reportDocument.findUnique({
      where: { checksumHash },
      include: { metadata: true },
    });
  }

  async findById(id: string) {
    return this.prisma.reportDocument.findUnique({
      where: { id },
      include: {
        metadata: true,
        chunks: {
          orderBy: { chunkIndex: 'asc' },
          include: { locations: true },
        },
        logs: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });
  }

  async findAll() {
    return this.prisma.reportDocument.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        metadata: true,
        _count: { select: { chunks: true } },
      },
    });
  }

  /**
   * Vector Retrieval Engine: Parameterized Raw SQL query using Cosine Distance <=> in pgvector with fallback
   */
  async findSimilarChunks(params: VectorSearchParams): Promise<RetrievalResult[]> {
    const limit = params.limit || 10;
    const threshold = params.similarityThreshold ?? 0.5;
    const vectorStr = `[${params.queryVector.join(',')}]`;

    // Skor placeholder yang digunakan saat pgvector tidak tersedia.
    // Nilai 0.5 dipilih secara sadar sebagai sinyal "medium-confidence fallback" —
    // bukan nilai tinggi (agar tidak menyesatkan pipeline RAG) dan bukan 0 (agar tidak diabaikan).
    const FALLBACK_SIMILARITY_SCORE = 0.5;

    try {
      // Parameterized Raw SQL using 1 - (embedding <=> $1::vector) as Cosine Similarity Score
      const rawResults: any[] = await this.prisma.$queryRawUnsafe(
        `
        SELECT 
          "id" AS "chunkId",
          "documentId",
          "chunkIndex",
          "rawText",
          "tokenCount",
          (1 - ("embedding"::vector <=> $1::vector)) AS "similarityScore"
        FROM "document_chunks"
        WHERE "documentId" = $2::uuid
          AND "embedding" IS NOT NULL
        ORDER BY "similarityScore" DESC
        LIMIT $3;
        `,
        vectorStr,
        params.documentId,
        limit,
      );

      this.logger.log(
        `[pgvector Search] Dokumen ID: ${params.documentId} - Ditemukan ${rawResults.length} chunks (Limit ${limit}).`,
      );

      return rawResults.map((r) => ({
        chunkId: r.chunkId,
        documentId: r.documentId,
        chunkIndex: r.chunkIndex,
        rawText: r.rawText,
        tokenCount: r.tokenCount,
        similarityScore: parseFloat(r.similarityScore) || 0.85,
      }));
    } catch (err: unknown) {
      // [FAIL-TRANSPARENT] Catat galat pgvector secara eksplisit sebelum beralih ke fallback.
      // Kegagalan diam-diam di sini akan menyebabkan RAG pipeline mendapatkan hasil non-semantik
      // tanpa ada sinyal peringatan, mempersulit debugging produksi secara signifikan.
      const errorMessage = err instanceof Error ? err.message : String(err);
      const errorStack   = err instanceof Error ? err.stack : undefined;
      this.logger.error(
        `[pgvector FALLBACK] Gagal menjalankan vector similarity search untuk Dokumen ID: ${params.documentId}. ` +
        `Beralih ke smart keyword-based fallback. ` +
        `Error: ${errorMessage}`,
        errorStack,
      );

      let chunks: any[] = [];
      const queryText = params.queryText;
      if (queryText) {
        // Kata henti umum Bahasa Indonesia untuk disaring dari pencarian kata kunci
        const stopwords = new Set([
          'dan', 'di', 'ke', 'dari', 'yang', 'untuk', 'dengan', 'ini', 'itu', 'adalah', 'yaitu', 'pada', 'atau', 'dalam', 'saya', 'kami', 'anda', 'mereka', 'dia'
        ]);
        const words = queryText
          .toLowerCase()
          .split(/[^a-zA-Z0-9]+/)
          .filter((w) => w.length > 2 && !stopwords.has(w));

        if (words.length > 0) {
          // Cari chunk yang mengandung minimal salah satu kata kunci melalui database (case-insensitive)
          const matchedDbChunks = await this.prisma.documentChunk.findMany({
            where: {
              documentId: params.documentId,
              OR: words.map((word) => ({
                rawText: {
                  contains: word,
                  mode: 'insensitive',
                },
              })),
            },
          });

          if (matchedDbChunks.length > 0) {
            // Hitung kemunculan kata kunci di setiap chunk untuk scoring relevansi in-memory
            const scoredChunks = matchedDbChunks.map((chunk) => {
              let matches = 0;
              const textLower = chunk.rawText.toLowerCase();
              for (const word of words) {
                let pos = textLower.indexOf(word);
                while (pos !== -1) {
                  matches++;
                  pos = textLower.indexOf(word, pos + word.length);
                }
              }
              return { chunk, matches };
            });

            // Urutkan berdasarkan frekuensi pencocokan terbanyak secara descending
            chunks = scoredChunks
              .filter((sc) => sc.matches > 0)
              .sort((a, b) => b.matches - a.matches)
              .map((sc) => sc.chunk)
              .slice(0, limit);

            this.logger.log(
              `[pgvector FALLBACK] Keyword search berhasil. Ditemukan ${chunks.length} chunks relevan berbasis kata kunci.`,
            );
          }
        }
      }

      // Fallback terakhir: Mengambil chunk awal secara sekuensial jika tidak ada pencocokan kata kunci
      if (chunks.length === 0) {
        this.logger.warn(
          `[pgvector FALLBACK] Keyword search menghasilkan 0 hasil atau queryText kosong. Menggunakan chronological fallback.`,
        );
        chunks = await this.prisma.documentChunk.findMany({
          where: { documentId: params.documentId },
          take: limit,
          orderBy: { chunkIndex: 'asc' },
        });
      }

      return chunks.map((c) => ({
        chunkId: c.id,
        documentId: c.documentId,
        chunkIndex: c.chunkIndex,
        rawText: c.rawText,
        tokenCount: c.tokenCount,
        // Skor eksplisit rendah — menandai bahwa hasil ini adalah fallback non-semantik,
        // bukan hasil cosine similarity sesungguhnya
        similarityScore: FALLBACK_SIMILARITY_SCORE,
      }));
    }
  }

  async createDocumentWithTransaction(input: CreateDocumentTransactionInput): Promise<ReportDocument> {
    return this.prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      // 1. Create Report Document Aggregate Root
      const document = await tx.reportDocument.create({
        data: {
          title: input.title,
          fileUrl: input.fileUrl,
          mimeType: input.mimeType,
          checksumHash: input.checksumHash,
          status: DocumentStatus.READY,
        },
      });

      // 2. Create Metadata (1:1)
      await tx.documentMetadata.create({
        data: {
          documentId: document.id,
          fileSizeBytes: input.fileSizeBytes,
          pageCount: input.pageCount,
          totalTokenCount: input.totalTokenCount,
          category: input.category,
          uploadedBy: input.uploadedBy,
          docType: input.docType || 'REALIZATION',
        },
      });

      // 3. Create Chunks (1:N) & Spatial Locations
      for (const item of input.chunks) {
        const vectorStr = item.embedding ? `[${item.embedding.join(',')}]` : null;
        const chunkRecord = await tx.documentChunk.create({
          data: {
            documentId: document.id,
            chunkIndex: item.chunkData.chunkIndex,
            rawText: item.chunkData.rawText,
            tokenCount: item.chunkData.tokenCount,
            embedding: vectorStr,
          },
        });

        // Insert geospatial locations if found
        if (item.locations.length > 0) {
          for (const loc of item.locations) {
            await tx.geospatialLocation.create({
              data: {
                chunkId: chunkRecord.id,
                locationName: loc.locationName,
                latitude: loc.latitude,
                longitude: loc.longitude,
                confidenceScore: loc.confidenceScore,
              },
            });
          }
        }
      }

      // 4. Log Extraction Audit Trail
      await tx.extractionLog.create({
        data: {
          documentId: document.id,
          status: LogStatus.SUCCESS,
          executionTimeMs: input.executionTimeMs,
        },
      });

      this.logger.log(
        `[Atomic Commit] Berhasil menyimpan dokumen ID ${document.id} (${input.chunks.length} chunks) ke PostgreSQL.`,
      );

      return document;
    });
  }

  async deleteDocument(id: string): Promise<boolean> {
    try {
      await this.prisma.reportDocument.delete({
        where: { id },
      });
      return true;
    } catch (err) {
      this.logger.error(`[Delete] Gagal menghapus dokumen ${id}:`, err);
      return false;
    }
  }
}

