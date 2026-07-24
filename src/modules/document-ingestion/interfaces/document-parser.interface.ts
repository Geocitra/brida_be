export interface ParsedDocumentOutput {
  rawText: string;
  pageCount: number;
}

export interface IDocumentParser {
  /**
   * Evaluates whether this strategy supports the given MIME type.
   */
  supports(mimeType: string): boolean;

  /**
   * Extracts raw text content and metadata from the document file buffer.
   * @param buffer File binary buffer
   */
  parse(buffer: Buffer): Promise<ParsedDocumentOutput>;
}
