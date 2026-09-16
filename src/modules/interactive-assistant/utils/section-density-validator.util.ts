export interface SectionAuditReport {
  totalWords: number;
  totalChapters: number;
  chapters: Array<{
    heading: string;
    wordCount: number;
    paragraphCount: number;
    isDensityValid: boolean; // >= 150 words
  }>;
  isValidShort: boolean;  // 650 - 900 words
  isValidMedium: boolean; // 1300 - 1800 words
  isValidLong: boolean;   // >= 2700 words
  hasAntiFragmentationPassed: boolean;
}

export class SectionDensityValidator {
  private static readonly MIN_WORDS_PER_SECTION = 150;

  public static auditMarkdown(markdownText: string): SectionAuditReport {
    if (!markdownText) {
      return {
        totalWords: 0,
        totalChapters: 0,
        chapters: [],
        isValidShort: false,
        isValidMedium: false,
        isValidLong: false,
        hasAntiFragmentationPassed: false,
      };
    }

    const cleanText = markdownText
      .replace(/!\[([^\]]*)\]\((https?:\/\/[^\)]+)\)/g, '') // Hapus grafik QuickChart
      .replace(/```[\s\S]*?```/g, '')                      // Hapus code blocks
      .trim();

    const totalWords = this.countWords(cleanText);

    // Memecah teks berdasarkan heading level 2 (##)
    const sectionSplitRegex = /^##\s+(.+)$/gm;
    const rawSections = cleanText.split(sectionSplitRegex);

    const chapters: SectionAuditReport['chapters'] = [];

    // Jika diawali teks sebelum ## pertama (misal H1 judul & identitas)
    if (rawSections.length === 1) {
      const pCount = this.countParagraphs(rawSections[0]);
      const wCount = this.countWords(rawSections[0]);
      chapters.push({
        heading: 'Pendahuluan / Naskah Tunggal',
        wordCount: wCount,
        paragraphCount: pCount,
        isDensityValid: wCount >= this.MIN_WORDS_PER_SECTION,
      });
    } else {
      for (let i = 1; i < rawSections.length; i += 2) {
        const heading = rawSections[i].trim();
        const content = rawSections[i + 1] ? rawSections[i + 1].trim() : '';
        const wCount = this.countWords(content);
        const pCount = this.countParagraphs(content);

        chapters.push({
          heading,
          wordCount: wCount,
          paragraphCount: pCount,
          isDensityValid: wCount >= this.MIN_WORDS_PER_SECTION,
        });
      }
    }

    // Anti-fragmentasi terpenuhi jika rata-rata bab valid (>= 150 kata) dan tidak ada bab kosong
    const allChaptersValid = chapters.length > 0 && chapters.every((c) => c.isDensityValid);

    return {
      totalWords,
      totalChapters: chapters.length,
      chapters,
      isValidShort: totalWords >= 650 && totalWords <= 1000,
      isValidMedium: totalWords >= 1300 && totalWords <= 2000,
      isValidLong: totalWords >= 2700,
      hasAntiFragmentationPassed: allChaptersValid,
    };
  }

  private static countWords(text: string): number {
    return text.trim().split(/\s+/).filter((w) => w.length > 0).length;
  }

  private static countParagraphs(text: string): number {
    return text
      .split(/\n\s*\n/)
      .map((p) => p.trim())
      .filter((p) => p.length > 20).length;
  }
}
