import { jsonrepair } from 'jsonrepair';

/**
 * QuickChart Markdown Sanitizer & Rescue Engine
 * (GRASP: Pure Fabrication & Protected Variations)
 *
 * Mengidentifikasi dan mengekstrak blok konfigurasi Chart.js dari URL QuickChart,
 * menangani string mentah maupun yang telah ter-encode secara malformed/parsial oleh LLM,
 * memperbaiki sintaks (quotes, hex color, typo %7Y, unencoded % dan kurung) menggunakan jsonrepair,
 * dan melakukan URL-encoding penuh (encodeURIComponent) pada parameter konfigurasi.
 *
 * Menghasilkan Markdown Image yang 100% aman dan kompatibel dengan CommonMark,
 * TipTap Editor Canvas A4, maupun Renderer PDF Chromium.
 */

/**
 * Mengekstrak objek JavaScript/JSON yang seimbang (balanced braces `{...}`)
 * dengan memperhitungkan string literal dan escape sequence.
 */
function extractBalancedObject(
  str: string,
  startIndex: number,
): { objectStr: string; endIndex: number } | null {
  let depth = 0;
  let inString: string | null = null;
  let isEscaped = false;
  let objStart = -1;

  for (let i = startIndex; i < str.length; i++) {
    const char = str[i];

    if (inString) {
      if (isEscaped) {
        isEscaped = false;
      } else if (char === '\\') {
        isEscaped = true;
      } else if (char === inString) {
        inString = null;
      }
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      inString = char;
      continue;
    }

    if (char === '{') {
      if (depth === 0) objStart = i;
      depth++;
    } else if (char === '}') {
      depth--;
      if (depth === 0 && objStart !== -1) {
        return {
          objectStr: str.substring(objStart, i + 1),
          endIndex: i + 1,
        };
      }
    }
  }

  return null;
}

/**
 * Menormalkan string chart configuration dari berbagai format encoding/malformed LLM output
 */
function safelyDecodeChartConfig(rawInput: string): string {
  if (!rawInput) return '';
  let str = rawInput.trim();

  // 1. Decode karakter percent-encoding standar
  str = str
    .replace(/%7B/gi, '{')
    .replace(/%7D/gi, '}')
    .replace(/%5B/gi, '[')
    .replace(/%5D/gi, ']')
    .replace(/%3A/gi, ':')
    .replace(/%2C/gi, ',')
    .replace(/%22/gi, '"')
    .replace(/%27/gi, "'")
    .replace(/%20/gi, ' ')
    .replace(/%23/gi, '#')
    .replace(/%28/gi, '(')
    .replace(/%29/gi, ')')
    .replace(/%2F/gi, '/');

  // 2. Perbaiki typo umum LLM seperti %7Y -> {"Y": atau %7y -> {"y":
  str = str.replace(/%7([a-zA-Z])/g, '{"$1"');

  // 3. Amankan karakter % liar yang tidak valid
  try {
    str = decodeURIComponent(str);
  } catch {
    try {
      const fixed = str.replace(/%(?![0-9a-fA-F]{2})/g, '%25');
      str = decodeURIComponent(fixed);
    } catch {}
  }

  return str;
}

export function sanitizeQuickChartMarkdown(markdown: string): string {
  if (!markdown || typeof markdown !== 'string') return '';

  let result = markdown;
  const qcMarker = 'quickchart.io/chart?';
  let searchPos = 0;

  // Batas iterasi maksimal untuk keamanan
  let iterations = 0;
  const MAX_ITERATIONS = 50;

  while (iterations++ < MAX_ITERATIONS) {
    const foundIdx = result.toLowerCase().indexOf(qcMarker, searchPos);
    if (foundIdx === -1) break;

    // 1. Cari titik awal protokol http:// atau https://
    const textBefore = result.substring(0, foundIdx);
    const httpMatch = textBefore.match(/(https?:\/\/)$/i);
    const httpStart = httpMatch ? foundIdx - httpMatch[0].length : foundIdx;

    let fullMatchStart = httpStart;
    let altText = 'Visualisasi Grafik Data';

    // Cek apakah ada tag markdown image ![alt]( atau link [alt]( sebelum httpStart
    const textBeforeHttp = result.substring(0, httpStart);
    const lastImgOpen = textBeforeHttp.lastIndexOf('![');
    const lastLinkOpen = textBeforeHttp.lastIndexOf('[');
    const lastOpen = lastImgOpen !== -1 ? lastImgOpen : lastLinkOpen;

    if (lastOpen !== -1 && lastOpen >= textBeforeHttp.length - 300) {
      const candidate = textBeforeHttp.substring(lastOpen);
      const m = candidate.match(/^(!?\[([^\]]*)\]\s*\(\s*)$/);
      if (m) {
        fullMatchStart = lastOpen;
        if (m[2] && m[2].trim()) {
          altText = m[2].trim().replace(/[\[\]]/g, '');
        }
      }
    }

    // 2. Cari parameter c= atau chart=
    const afterQc = result.substring(foundIdx + qcMarker.length);
    const cMatch = afterQc.match(/^(?:[^ \n\r"'>]*?[?&])?(c|chart)=/i);

    if (cMatch) {
      const cStart = foundIdx + qcMarker.length + cMatch[0].length;
      const subFromC = result.substring(cStart);

      // Ambil seluruh chunk pada baris tersebut hingga akhir baris
      const lineEnd = subFromC.search(/[\n\r]/);
      const lineChunk = lineEnd !== -1 ? subFromC.substring(0, lineEnd) : subFromC;

      // Bersihkan karakter penutup markdown di ujung baris jika ada
      let rawChunk = lineChunk.trimEnd();
      const trailMatch = rawChunk.match(/[\)\]\>]+$/);
      if (trailMatch) {
        rawChunk = rawChunk.substring(0, rawChunk.length - trailMatch[0].length);
      }

      const replaceEnd = cStart + lineChunk.length;

      // Decode & normalisasi string chart config
      const decoded = safelyDecodeChartConfig(rawChunk);
      let configStr = '';

      if (decoded.includes('{')) {
        const braceOffset = decoded.indexOf('{');
        const balanced = extractBalancedObject(decoded, braceOffset);
        if (balanced) {
          configStr = balanced.objectStr;
        }
      }

      if (configStr) {
        try {
          const repaired = jsonrepair(configStr);
          const parsed = JSON.parse(repaired);
          const encoded = encodeURIComponent(JSON.stringify(parsed));
          const safeUrl = `https://quickchart.io/chart?c=${encoded}&bkg=white&w=650&h=350&devicePixelRatio=2`;
          const replacement = `\n\n![${altText}](${safeUrl})\n\n`;

          result = result.substring(0, fullMatchStart) + replacement + result.substring(replaceEnd);
          searchPos = fullMatchStart + replacement.length;
          continue;
        } catch {
          try {
            const safeEncoded = encodeURIComponent(configStr);
            const safeUrl = `https://quickchart.io/chart?c=${safeEncoded}&bkg=white&w=650&h=350&devicePixelRatio=2`;
            const replacement = `\n\n![${altText}](${safeUrl})\n\n`;

            result = result.substring(0, fullMatchStart) + replacement + result.substring(replaceEnd);
            searchPos = fullMatchStart + replacement.length;
            continue;
          } catch {}
        }
      }
    }

    searchPos = foundIdx + qcMarker.length;
  }

  return result.replace(/\n{3,}/g, '\n\n');
}
