export type IntentType = 'ANALYTICAL_QA' | 'ARTICLE_GENERATION';

export interface IntentExecutionPayload {
  sessionId: string;
  documentId?: string; // Diubah menjadi opsional karena mendukung Zero-Reference Mode
  query: string;

  // Penambahan opsional array objek lampiran berkas/screenshots
  attachments?: Array<{
    fileId: string;
    classification?: 'BASELINE' | 'REALIZATION' | 'GENERAL_REFERENCE';
  }>;

  // Penambahan opsional draf naskah Markdown aktif dari editor visual
  currentDraft?: string;
}

export interface IIntentHandler {
  /**
   * Identifies intent type
   */
  getIntentType(): IntentType;

  /**
   * Evaluates if query matches this intent via Heuristic Keyword Inspection
   */
  canHandle(query: string): boolean;

  /**
   * Executes specific intent pipeline strategy
   */
  execute(payload: IntentExecutionPayload): Promise<any>;
}
