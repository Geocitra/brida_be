import {
  Injectable,
  ConflictException,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
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
import { PrismaService } from '../../../common/prisma/prisma.service';

@Injectable()
export class DocumentIngestionService {
  private readonly logger = new Logger(DocumentIngestionService.name);
  private readonly uploadDir = path.resolve(process.env.UPLOAD_DESTINATION || './uploads');
  private readonly tempDir = path.join(this.uploadDir, 'temp');

  constructor(
    private readonly parserFactory: ParserFactory,
    private readonly sanitizerPipeline: TextSanitizerPipeline,
    private readonly semanticChunker: SemanticChunkerService,
    private readonly embeddingProvider: ExternalEmbeddingAdapter,
    private readonly batchProcessor: EmbeddingBatchProcessor,
    private readonly geospatialParser: GeospatialParserService,
    private readonly repository: DocumentRepository,
    private readonly prisma: PrismaService, // Menyuntikkan PrismaService untuk pembaruan metadata virtual
  ) {
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  /**
   * Mengolah unggahan dokumen acuan langsung ke repositori global (Standard Path).
   */
  async processDocumentUpload(
    file: Express.Multer.File,
    dto: UploadDocumentDto,
  ): Promise<DocumentResponseDto> {
    return this.ingestDocumentCore(file.buffer, file.originalname, file.mimetype, dto);
  }

  /**
   * Menyimpan berkas/screenshot sementara secara transien (Chat Level).
   * Mengembalikan fileId transien agar UI dapat menyimpannya di antrean draf chat.
   */
  async processTemporaryUpload(file: Express.Multer.File): Promise<{
    tempFileId: string;
    fileName: string;
    mimeType: string;
    fileSizeBytes: string;
    tempPath: string;
  }> {
    const tempFileId = crypto.randomUUID();
    const encodedMime = Buffer.from(file.mimetype).toString('hex');

    // Naming pattern: uuid__mimehex__originalname
    const tempFileName = `${tempFileId}__${encodedMime}__${file.originalname}`;
    const tempFilePath = path.join(this.tempDir, tempFileName);

    fs.writeFileSync(tempFilePath, file.buffer);
    this.logger.log(`[Temp Saved] Berkas transien berhasil disimpan di disk: ${tempFileName}`);

    return {
      tempFileId,
      fileName: file.originalname,
      mimeType: file.mimetype,
      fileSizeBytes: file.size.toString(),
      tempPath: tempFilePath,
    };
  }

  /**
   * Ingestion Bypass: Mengubah berkas transien hasil chat menjadi dokumen repositori permanen.
   * Dipanggil saat pesan dikirim bersama ID berkas sementara dan klasifikasi pilihan pengguna.
   */
  async convertTempToPermanent(
    tempFileId: string,
    dto: UploadDocumentDto,
  ): Promise<DocumentResponseDto> {
    this.logger.log(`[Ingestion Bypass] Memulai konversi berkas transien ID '${tempFileId}'...`);

    // 1. Cari file transien di direktori temp berdasarkan UUID prefix
    const files = fs.readdirSync(this.tempDir);
    const targetFile = files.find((f) => f.startsWith(tempFileId));

    if (!targetFile) {
      throw new NotFoundException(
        `Berkas sementara dengan ID '${tempFileId}' telah kedaluwarsa atau tidak ditemukan di server.`,
      );
    }

    const tempFilePath = path.join(this.tempDir, targetFile);

    // 2. Dekode Metadata (Stateless Decoding)
    const parts = targetFile.split('__');
    if (parts.length < 3) {
      throw new BadRequestException('Nama berkas transien mengalami kerusakan format metadata.');
    }

    const mimeType = Buffer.from(parts[1], 'hex').toString('utf-8');
    const originalName = parts.slice(2).join('__'); // Gabungkan kembali jika original name mengandung pembatas

    // 3. Baca Buffer & Jalankan Core Ingestion Pipeline
    const fileBuffer = fs.readFileSync(tempFilePath);
    const result = await this.ingestDocumentCore(fileBuffer, originalName, mimeType, dto);

    // Bersihkan file sementara dari direktori temp setelah sukses di-commit ke DB
    try {
      fs.unlinkSync(tempFilePath);
      this.logger.log(`[Cleanup Pass] Berkas transien '${targetFile}' berhasil dihapus.`);
    } catch (cleanupErr) {
      const errorMessage = cleanupErr instanceof Error ? cleanupErr.message : String(cleanupErr);
      this.logger.warn(`Gagal menghapus berkas transien: ${errorMessage}`);
    }

    return result;
  }

  /**
   * Mengolah dokumen virtual hasil scraping dari internet secara transaksional
   * dan menyimpannya sebagai fisik berkas teks lokal agar kompatibel dengan pembaca internal.
   */
  async processScrapedWebDocument(
    scrapedText: string,
    title: string,
    sourceUrl: string,
    category: string = 'Referensi Umum & Kliping',
    additionalMeta: Record<string, any> = {},
  ): Promise<DocumentResponseDto> {
    const startTime = Date.now();
    this.logger.log(`[Virtual Ingestion] Menjalankan pipa pengayaan untuk dokumen hasil scrap: ${title}`);

    // 1. Hitung Checksum SHA-256 dari teks mentah untuk memblokir duplikasi scraping
    const textBuffer = Buffer.from(scrapedText, 'utf-8');
    const checksumHash = crypto.createHash('sha256').update(textBuffer).digest('hex');

    const existingDoc = await this.repository.findByChecksum(checksumHash);
    if (existingDoc) {
      this.logger.log(`[Virtual Cache Hit] Artikel berita/dokumen web sudah tersimpan sebelumnya: ${existingDoc.id}`);
      return this.getDocumentDetails(existingDoc.id);
    }

    // 2. Simpan naskah bersih secara fisik sebagai file teks .txt di direktori uploads
    const fileNameOnDisk = `scraped_${checksumHash}.txt`;
    const filePathOnDisk = path.join(this.uploadDir, fileNameOnDisk);
    fs.writeFileSync(filePathOnDisk, textBuffer);

    // 3. Jalankan Pipeline Sanitasi
    const sanitizedText = this.sanitizerPipeline.sanitize(scrapedText);

    // 4. Pembagian Chunk Semantik
    const chunkObjects = this.semanticChunker.createSemanticChunks(sanitizedText);

    // 5. Batching Generator Embedding Semantik
    const chunksWithEmbeddings = await this.batchProcessor.processInBatches(
      chunkObjects,
      this.embeddingProvider,
    );

    // 6. Ekstraksi Lokasi Geospasial PostGIS & Deteksi Kerapatan Distrik
    let totalTokenCount = 0;
    let totalLocationsCount = 0;
    const chunkItems = chunksWithEmbeddings.map((item) => {
      totalTokenCount += item.chunkData.tokenCount;
      const locations = this.geospatialParser.extractGeospatialLocations(item.chunkData.rawText);
      const spatialAnalysis = this.geospatialParser.calculateDistrictDensity(item.chunkData.rawText);
      totalLocationsCount += locations.length;
      return {
        chunkData: item.chunkData,
        embedding: item.embedding,
        locations,
        detectedDistricts: spatialAnalysis.detected,
        districtDensity: spatialAnalysis.density,
      };
    });

    const executionTimeMs = Date.now() - startTime;

    // 7. Commit Transaksional ke PostgreSQL DB (Atomic Transaction)
    const savedDoc = await this.repository.createDocumentWithTransaction({
      title: title,
      fileUrl: filePathOnDisk,
      mimeType: 'text/plain',
      checksumHash,
      fileSizeBytes: BigInt(textBuffer.length),
      pageCount: Math.max(1, Math.ceil(scrapedText.length / 3000)),
      totalTokenCount,
      category: category,
      uploadedBy: 'AKLS_SCRAPER_BOT',
      docType: 'GENERAL_REFERENCE',
      chunks: chunkItems,
      executionTimeMs,
    });

    // 8. Sinkronisasi Metadata Tambahan (sourceUrl & externalMetadata) ke tabel DocumentMetadata
    try {
      await this.prisma.documentMetadata.update({
        where: { documentId: savedDoc.id },
        data: {
          sourceUrl: sourceUrl,
          externalMetadata: {
            scrapedAt: new Date().toISOString(),
            originalLength: scrapedText.length,
            ...additionalMeta,
          },
        },
      });
      this.logger.log(`[Virtual Ingestion Done] Metadata eksternal berhasil disinkronkan untuk Dokumen ID: ${savedDoc.id}`);
    } catch (metaErr: any) {
      this.logger.error(`[Metadata Sync Failed] Gagal mencatat metadata eksternal: ${metaErr.message}`);
    }

    return {
      id: savedDoc.id,
      title: savedDoc.title,
      fileUrl: savedDoc.fileUrl,
      mimeType: savedDoc.mimeType,
      checksumHash: savedDoc.checksumHash,
      status: savedDoc.status,
      createdAt: savedDoc.createdAt,
      metadata: {
        fileSizeBytes: textBuffer.length.toString(),
        pageCount: Math.max(1, Math.ceil(scrapedText.length / 3000)),
        totalTokenCount,
        category: category,
        uploadedBy: 'AKLS_SCRAPER_BOT',
        docType: 'GENERAL_REFERENCE',
        sourceUrl: sourceUrl,
      },
      chunkCount: chunkObjects.length,
      extractedLocationsCount: totalLocationsCount,
    };
  }

  /**
   * Core Ingestion Pipeline (Atomic Transaction)
   * Menyediakan aliran kerja tunggal untuk rekayasa dokumen (Parsing -> Sanitasi -> Chunking -> Embedding -> DB Commit)
   */
  private async ingestDocumentCore(
    buffer: Buffer,
    originalname: string,
    mimetype: string,
    dto: UploadDocumentDto,
  ): Promise<DocumentResponseDto> {
    const startTime = Date.now();

    // 1. Hitung Checksum SHA-256 untuk memblokir duplikasi
    const checksumHash = crypto.createHash('sha256').update(buffer).digest('hex');

    const existingDoc = await this.repository.findByChecksum(checksumHash);
    if (existingDoc) {
      this.logger.warn(`Dokumen duplikat terdeteksi dengan Checksum: ${checksumHash}`);
      throw new ConflictException({
        message: 'Dokumen ini sudah pernah diunggah sebelumnya ke dalam sistem BRIDA SMART Analysis.',
        existingDocumentId: existingDoc.id,
      });
    }

    // 2. Simpan fisik dokumen secara permanen di uploads
    const fileExtension = path.extname(originalname);
    const fileNameOnDisk = `${checksumHash}${fileExtension}`;
    const filePathOnDisk = path.join(this.uploadDir, fileNameOnDisk);
    fs.writeFileSync(filePathOnDisk, buffer);

    // 3. Parsing Teks menggunakan adapter terpilih
    const parser = this.parserFactory.getParser(mimetype);
    const extracted = await parser.parse(buffer);

    // 4. Jalankan Pipeline Sanitasi
    const sanitizedText = this.sanitizerPipeline.sanitize(extracted.rawText);

    // 5. Pembagian Chunk Semantik
    const chunkObjects = this.semanticChunker.createSemanticChunks(sanitizedText);

    // 6. Batching Generator Embedding semantik
    const chunksWithEmbeddings = await this.batchProcessor.processInBatches(
      chunkObjects,
      this.embeddingProvider,
    );

    // 7. Ekstraksi Lokasi Geospasial PostGIS & Deteksi Kerapatan Distrik dari teks chunk
    let totalTokenCount = 0;
    let totalLocationsCount = 0;
    const chunkItems = chunksWithEmbeddings.map((item) => {
      totalTokenCount += item.chunkData.tokenCount;
      const locations = this.geospatialParser.extractGeospatialLocations(item.chunkData.rawText);
      const spatialAnalysis = this.geospatialParser.calculateDistrictDensity(item.chunkData.rawText);
      totalLocationsCount += locations.length;
      return {
        chunkData: item.chunkData,
        embedding: item.embedding,
        locations,
        detectedDistricts: spatialAnalysis.detected,
        districtDensity: spatialAnalysis.density,
      };
    });

    const executionTimeMs = Date.now() - startTime;

    // 8. Commit Transaksional ke PostgreSQL DB (Atomic Transaction)
    const savedDoc = await this.repository.createDocumentWithTransaction({
      title: dto.title,
      fileUrl: filePathOnDisk,
      mimeType: mimetype,
      checksumHash,
      fileSizeBytes: BigInt(buffer.length),
      pageCount: extracted.pageCount,
      totalTokenCount,
      category: dto.category || 'General Report',
      uploadedBy: dto.uploadedBy || 'SYSTEM_STAF',
      docType: dto.docType || 'REALIZATION',
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
        fileSizeBytes: buffer.length.toString(),
        pageCount: extracted.pageCount,
        totalTokenCount,
        category: dto.category || 'General Report',
        uploadedBy: dto.uploadedBy || 'SYSTEM_STAF',
        docType: dto.docType || 'REALIZATION',
      },
      chunkCount: chunkObjects.length,
      extractedLocationsCount: totalLocationsCount,
    };
  }

  async listAllDocuments(): Promise<DocumentResponseDto[]> {
    const docs = await this.repository.findAll();
    return docs.map((doc: (typeof docs)[number]) => ({
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
          docType: doc.metadata.docType,
          sourceUrl: doc.metadata.sourceUrl || undefined,
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
          docType: doc.metadata.docType,
          sourceUrl: doc.metadata.sourceUrl || undefined,
        }
        : undefined,
      chunkCount: doc.chunks ? doc.chunks.length : 0,
      extractedLocationsCount: locationCount,
      chunks: doc.chunks
        ? doc.chunks.map((c: (typeof doc.chunks)[number]) => ({
          chunkIndex: c.chunkIndex,
          rawText: c.rawText,
          tokenCount: c.tokenCount,
        }))
        : [],
    };
  }

  async deleteDocument(documentId: string): Promise<boolean> {
    const doc = await this.repository.findById(documentId);
    if (!doc) {
      throw new NotFoundException(`Dokumen dengan ID '${documentId}' tidak ditemukan.`);
    }
    return this.repository.deleteDocument(documentId);
  }

  async getDocumentFile(documentId: string): Promise<{ filePath: string; mimeType: string; fileName: string }> {
    const doc = await this.repository.findById(documentId);
    if (!doc) {
      throw new NotFoundException(`Dokumen dengan ID '${documentId}' tidak ditemukan.`);
    }
    if (!fs.existsSync(doc.fileUrl)) {
      throw new NotFoundException(`Berkas fisik dokumen tidak ditemukan di server.`);
    }
    return {
      filePath: doc.fileUrl,
      mimeType: doc.mimeType,
      fileName: `${doc.title}${path.extname(doc.fileUrl)}`,
    };
  }

  async retroactiveTagging(): Promise<{ updatedChunksCount: number; updatedDocumentsCount: number }> {
    this.logger.log('[Retroactive Tagging] Memulai proses sinkronisasi riwayat dokumen...');

    const chunks = await this.repository.findChunksForRetroactiveSync();

    if (chunks.length === 0) {
      this.logger.log('[Retroactive Tagging] Semua dokumen sudah tersinkronisasi. 0 chunk diproses.');
      return { updatedChunksCount: 0, updatedDocumentsCount: 0 };
    }

    const docIds = new Set<string>();
    let updatedChunksCount = 0;

    for (const chunk of chunks) {
      const spatialAnalysis = this.geospatialParser.calculateDistrictDensity(chunk.rawText);
      if (spatialAnalysis.detected.length > 0) {
        await this.repository.updateChunkSpatialMetadata(chunk.id, spatialAnalysis.detected, spatialAnalysis.density);
        docIds.add(chunk.documentId);
        updatedChunksCount++;
      }
    }

    this.logger.log(`[Retroactive Tagging] Sinkronisasi selesai. Berhasil memperbarui ${updatedChunksCount} chunk di ${docIds.size} dokumen.`);
    return {
      updatedChunksCount,
      updatedDocumentsCount: docIds.size,
    };
  }
}