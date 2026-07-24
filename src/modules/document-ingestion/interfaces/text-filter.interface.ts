export interface ITextFilter {
  /**
   * Filter name for logging and auditing
   */
  readonly filterName: string;

  /**
   * Sanitizes input text string
   */
  filter(text: string): string;
}
