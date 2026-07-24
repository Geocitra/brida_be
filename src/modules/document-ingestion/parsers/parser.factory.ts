import { Injectable, UnsupportedMediaTypeException, Logger } from '@nestjs/common';
import { IDocumentParser } from '../interfaces/document-parser.interface';
import { PdfParserAdapter } from './pdf-parser.adapter';
import { DocxParserAdapter } from './docx-parser.adapter';
import { TxtParserAdapter } from './txt-parser.adapter';

@Injectable()
export class ParserFactory {
  private readonly logger = new Logger(ParserFactory.name);
  private readonly parsers: IDocumentParser[];

  constructor(
    pdfParser: PdfParserAdapter,
    docxParser: DocxParserAdapter,
    txtParser: TxtParserAdapter,
  ) {
    // Registered parsers array
    this.parsers = [pdfParser, docxParser, txtParser];
  }

  getParser(mimeType: string): IDocumentParser {
    const parser = this.parsers.find((p) => p.supports(mimeType));

    if (!parser) {
      this.logger.warn(`ParserFactory: Tidak ada strategy parser yang mendukung MIME type '${mimeType}'`);
      throw new UnsupportedMediaTypeException(
        `Format dokumen '${mimeType}' tidak didukung oleh mesin parsing BRIDA SMART Analysis.`,
      );
    }

    return parser;
  }
}
