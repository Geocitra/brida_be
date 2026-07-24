import { Injectable, ConflictException, Logger, NotFoundException } from '@nestjs/common';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { ParserFactory } from '../parsers/parser.factory';
import { TextSanitizerPipeline } from '../utils/sanitizers/text-sanitizer.pipeline';
import { SemanticChunkerService } from './semantic-chunker.service';
import { ExternalEmbeddingAdapter } from '../providers/external-embedding.adapter';
import { EmbeddingBatchProcessor } from '../utils/embedding-batch-processor.util';
import { GeospatialParserService } from './geospatial-parser.service';
import { DocumentRepository } from '../repositories/document.repository';
import { UploadDocumentDto } from '../dtos/upload-document.dto';
import { DocumentResponseDto } from '../dtos/document-response.dto';

@Injectable()
export class DocumentIngestionService {
  private readonly logger = new Logger(DocumentIngestionService.name);
  private readonly uploadDir = path.resolve(process.env.UPLOAD_DESTINATION || './uploads');

  constructor(
    private readonly parserFactory: ParserFactory,
    private readonly sanitizerPipeline: TextSanitizerPipeline,
    private readonly semanticChunker: SemanticChunkerService,
    private readonly embeddingProvider: ExternalEmbeddingAdapter,
    private readonly batchProcessor: EmbeddingBatchProcessor,
    private readonly geospatialParser: GeospatialParserService,
    private readonly repository: DocumentRepository,
  ) {
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }
  }

  async processDocumentUpload(
    file: Express.Multer.File,
    dto: UploadDocumentDto,
  ): Promise<DocumentResponseDto> {
    const startTime = Date.now();

    // 1. Calculate Checksum (SHA-256)
    const checksumHash = crypto.createHash('sha256').update(file.buffer).digest('hex');

    // 2. Check for duplicate document
    const existingDoc = await this.repository.findByChecksum(checksumHash);
    if (existingDoc) {
      this.logger.warn(`Dokumen duplikat terdeteksi dengan Checksum: ${checksumHash}`);
      throw new ConflictException({
        message: 'Dokumen ini sudah pernah diunggah sebelumnya ke dalam sistem BRIDA SMART Analysis.',
        existingDocumentId: existingDoc.id,
      });
    }

    // 3. Save physical file safely
    const fileExtension = path.extname(file.originalname);
    const fileNameOnDisk = `${checksumHash}${fileExtension}`;
    const filePathOnDisk = path.join(this.uploadDir, fileNameOnDisk);
    fs.writeFileSync(filePathOnDisk, file.buffer);

    // 4. Resolve Parser Strategy via ParserFactory & Extract Text (Sprint 1.2)
    const parser = this.parserFactory.getParser(file.mimetype);
    const extracted = await parser.parse(file.buffer);

    // 5. Run Text Sanitization Pipeline (Sprint 1.3 Step 1)
    const sanitizedText = this.sanitizerPipeline.sanitize(extracted.rawText);

    // 6. Create Semantic Chunks (Array of ChunkData Objects with Spatial Metadata & Overlap)
    const chunkObjects = this.semanticChunker.createSemanticChunks(sanitizedText);

    // 7. Batch Process Embeddings (Sprint 1.4 Step 3)
    const chunksWithEmbeddings = await this.batchProcessor.processInBatches(
      chunkObjects,
      this.embeddingProvider,
    );

    // 8. Extract Geospatial Locations from Chunks
    let totalTokenCount = 0;
    let totalLocationsCount = 0;
    const chunkItems = chunksWithEmbeddings.map((item) => {
      totalTokenCount += item.chunkData.tokenCount;
      const locations = this.geospatialParser.extractGeospatialLocations(item.chunkData.rawText);
      totalLocationsCount += locations.length;
      return {
        chunkData: item.chunkData,
        embedding: item.embedding,
        locations,
      };
    });

    const executionTimeMs = Date.now() - startTime;

    // 9. Atomic Database Transaction (PostgreSQL + pgvector)
    const savedDoc = await this.repository.createDocumentWithTransaction({
      title: dto.title,
      fileUrl: filePathOnDisk,
      mimeType: file.mimetype,
      checksumHash,
      fileSizeBytes: BigInt(file.size),
      pageCount: extracted.pageCount,
      totalTokenCount,
      category: dto.category || 'General Report',
      uploadedBy: dto.uploadedBy || 'SYSTEM_STAF',
      chunks: chunkItems,
      executionTimeMs,
    });

    return {
      id: savedDoc.id,
      title: savedDoc.title,
      fileUrl: savedDoc.fileUrl,
      mimeType: savedDoc.mimeType,
      checksumHash: savedDoc.checksumHash,
      status: savedDoc.status,
      createdAt: savedDoc.createdAt,
      metadata: {
        fileSizeBytes: file.size.toString(),
        pageCount: extracted.pageCount,
        totalTokenCount,
        category: dto.category || 'General Report',
        uploadedBy: dto.uploadedBy || 'SYSTEM_STAF',
      },
      chunkCount: chunkObjects.length,
      extractedLocationsCount: totalLocationsCount,
    };
  }

  async listAllDocuments(): Promise<DocumentResponseDto[]> {
    const docs = await this.repository.findAll();
    return docs.map((doc) => ({
      id: doc.id,
      title: doc.title,
      fileUrl: doc.fileUrl,
      mimeType: doc.mimeType,
      checksumHash: doc.checksumHash,
      status: doc.status,
      createdAt: doc.createdAt,
      metadata: doc.metadata
        ? {
            fileSizeBytes: doc.metadata.fileSizeBytes.toString(),
            pageCount: doc.metadata.pageCount,
            totalTokenCount: doc.metadata.totalTokenCount,
            category: doc.metadata.category,
            uploadedBy: doc.metadata.uploadedBy,
          }
        : undefined,
      chunkCount: doc._count?.chunks ?? 0,
      extractedLocationsCount: 0,
    }));
  }

  async getDocumentDetails(documentId: string): Promise<DocumentResponseDto> {
    const doc = await this.repository.findById(documentId);
    if (!doc) {
      throw new NotFoundException(`Dokumen dengan ID '${documentId}' tidak ditemukan.`);
    }

    let locationCount = 0;
    if (doc.chunks) {
      locationCount = doc.chunks.reduce(
        (acc: number, chunk: any) => acc + (chunk.locations ? chunk.locations.length : 0),
        0,
      );
    }

    return {
      id: doc.id,
      title: doc.title,
      fileUrl: doc.fileUrl,
      mimeType: doc.mimeType,
      checksumHash: doc.checksumHash,
      status: doc.status,
      createdAt: doc.createdAt,
      metadata: doc.metadata
        ? {
            fileSizeBytes: doc.metadata.fileSizeBytes.toString(),
            pageCount: doc.metadata.pageCount,
            totalTokenCount: doc.metadata.totalTokenCount,
            category: doc.metadata.category,
            uploadedBy: doc.metadata.uploadedBy,
          }
        : undefined,
      chunkCount: doc.chunks ? doc.chunks.length : 0,
      extractedLocationsCount: locationCount,
    };
  }
}
