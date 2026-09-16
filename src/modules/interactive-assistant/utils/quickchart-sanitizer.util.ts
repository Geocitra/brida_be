/**
 * QuickChart Markdown Sanitizer & Rescue Engine
 * (GRASP: Pure Fabrication & Protected Variations)
 * 
 * Melindungi sistem dari kesalahan sintaks Markdown Image yang dihasilkan oleh LLM.
 * Mengonversi spasi dalam URL QuickChart menjadi %20, membersihkan tanda kutip ganda menjadi %22,
 * dan memastikan formatnya selalu berupa Markdown Image valid: ![Alt](safeUrl).
 */
export function sanitizeQuickChartMarkdown(markdown: string): string {
  if (!markdown) return '';

  return markdown
    .replace(
      /!?\[*([^\]\n\r]*?)\]*\(?\s*(https?:\/\/quickchart\.io\/chart\?[^\n\r\)]+(?:[ \t]+[^\n\r\)]+)*)\s*\)?\]*/gi,
      (match, altText, rawUrl) => {
        const cleanAlt =
          (altText && altText.replace(/[\[\]]/g, '').trim()) ||
          'Visualisasi Grafik Data';

        let cleanUrl = rawUrl.trim();
        while (
          cleanUrl.startsWith('<') ||
          cleanUrl.startsWith('(') ||
          cleanUrl.startsWith('[')
        ) {
          cleanUrl = cleanUrl.substring(1);
        }
        while (
          cleanUrl.endsWith('>') ||
          cleanUrl.endsWith(')') ||
          cleanUrl.endsWith(']')
        ) {
          cleanUrl = cleanUrl.substring(0, cleanUrl.length - 1);
        }

        // Encode spasi menjadi %20 dan kutip dua menjadi %22
        const safeUrl = cleanUrl.replace(/\s+/g, '%20').replace(/"/g, '%22');

        return `\n\n![${cleanAlt}](${safeUrl})\n\n`;
      },
    )
    .replace(/\n{3,}/g, '\n\n');
}
