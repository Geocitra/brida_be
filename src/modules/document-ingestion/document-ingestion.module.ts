import { Module } from '@nestjs/common';
import { DocumentIngestionController } from './controllers/document-ingestion.controller';
import { DocumentIngestionService } from './services/document-ingestion.service';
import { SemanticChunkerService } from './services/semantic-chunker.service';
import { GeospatialParserService } from './services/geospatial-parser.service';
import { DocumentRepository } from './repositories/document.repository';
import { PdfParserAdapter } from './parsers/pdf-parser.adapter';
import { DocxParserAdapter } from './parsers/docx-parser.adapter';
import { TxtParserAdapter } from './parsers/txt-parser.adapter';
import { ParserFactory } from './parsers/parser.factory';

import { ExternalEmbeddingAdapter } from './providers/external-embedding.adapter';
import { EmbeddingBatchProcessor } from './utils/embedding-batch-processor.util';
import { OpenAiVisionOcrService } from './services/openai-vision-ocr.service';

import { UnicodeNormalizerFilter } from './utils/sanitizers/unicode-normalizer.filter';
import { WhitespaceTrimmerFilter } from './utils/sanitizers/whitespace-trimmer.filter';
import { HeaderFooterRemoverFilter } from './utils/sanitizers/header-footer-remover.filter';
import { TextSanitizerPipeline } from './utils/sanitizers/text-sanitizer.pipeline';

@Module({
  controllers: [DocumentIngestionController],
  providers: [
    DocumentIngestionService,
    SemanticChunkerService,
    GeospatialParserService,
    DocumentRepository,
    PdfParserAdapter,
    DocxParserAdapter,
    TxtParserAdapter,
    ParserFactory,
    OpenAiVisionOcrService,

    ExternalEmbeddingAdapter,
    EmbeddingBatchProcessor,

    UnicodeNormalizerFilter,
    WhitespaceTrimmerFilter,
    HeaderFooterRemoverFilter,
    TextSanitizerPipeline,
  ],
  exports: [
    DocumentIngestionService,
    DocumentRepository,
    ParserFactory,
    TextSanitizerPipeline,
    SemanticChunkerService,
    ExternalEmbeddingAdapter,
    EmbeddingBatchProcessor,
    OpenAiVisionOcrService,
  ],
})
export class DocumentIngestionModule { }
