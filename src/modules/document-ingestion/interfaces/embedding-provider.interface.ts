export interface IEmbeddingProvider {
  /**
   * Generates dense vector embeddings for an array of text strings
   */
  generateEmbeddings(texts: string[]): Promise<number[][]>;

  /**
   * Returns vector dimension count (e.g. 768 or 1536)
   */
  getVectorDimension(): number;
}
