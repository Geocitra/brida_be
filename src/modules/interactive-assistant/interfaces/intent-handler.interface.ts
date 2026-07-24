export type IntentType = 'ANALYTICAL_QA' | 'ARTICLE_GENERATION';

export interface IntentExecutionPayload {
  sessionId: string;
  documentId: string;
  query: string;
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
