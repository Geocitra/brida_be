import { jsonrepair } from 'jsonrepair';

/**
 * QuickChart Markdown Sanitizer & Rescue Engine
 * (GRASP: Pure Fabrication & Protected Variations)
 *
 * Mengidentifikasi dan mengekstrak blok konfigurasi Chart.js dari URL QuickChart,
 * menangani string mentah maupun yang telah ter-encode secara malformed/parsial oleh LLM,
 * memvalidasi tipe chart agar 100% kompatibel dengan QuickChart Chart.js v3 (mencegah error "flowchart is not a chart type" atau "requires Chart.js v3 or v4"),
 * memperbaiki sintaks (quotes, hex color, typo %7Y, unencoded % dan kurung) menggunakan jsonrepair,
 * dan melakukan URL-encoding penuh (encodeURIComponent) pada parameter konfigurasi.
 *
 * Menghasilkan Markdown Image yang 100% aman dan kompatibel dengan CommonMark,
 * TipTap Editor Canvas A4, maupun Renderer PDF Chromium.
 */

const VALID_CHART_TYPES = [
  'bar',
  'line',
  'pie',
  'doughnut',
  'radar',
  'polarArea',
  'scatter',
  'bubble',
];

/**
 * Normalisasi konfigurasi Chart.js agar kompatibel penuh dengan QuickChart v3.
 * Mengubah tipe tidak valid (misal: 'flowchart', 'sankey', 'process') menjadi grafik tahapan/horizontal bar yang sah.
 */
export function normalizeChartConfig(parsed: any, altText: string = 'Visualisasi Grafik Data'): any {
  if (!parsed || typeof parsed !== 'object') {
    return createDefaultBarChart(altText);
  }

  let type = String(parsed.type || 'bar').trim();
  const lowerType = type.toLowerCase();

  if (!parsed.options || typeof parsed.options !== 'object') {
    parsed.options = {};
  }

  // 1. Tangani horizontalBar -> Pada Chart.js v3, horizontal bar adalah type 'bar' dengan indexAxis: 'y'
  if (lowerType === 'horizontalbar') {
    parsed.type = 'bar';
    parsed.options.indexAxis = 'y';
  } else if (VALID_CHART_TYPES.includes(lowerType)) {
    parsed.type = lowerType;
  } else {
    // 2. Tangani tipe tidak didukung oleh Chart.js (misal 'flowchart', 'sankey', 'diagram', 'process', dll)
    // Ubah menjadi horizontal bar chart untuk menggambarkan progres atau tahapan alur secara elegan
    parsed.type = 'bar';
    parsed.options.indexAxis = 'y';

    if (!parsed.data || typeof parsed.data !== 'object') {
      parsed.data = {};
    }

    // Ambil label dari labels array atau ekstrak dari nodes/edges jika AI mengarang skema flowchart/sankey
    if (!Array.isArray(parsed.data.labels) || parsed.data.labels.length === 0) {
      if (Array.isArray(parsed.data.nodes) && parsed.data.nodes.length > 0) {
        parsed.data.labels = parsed.data.nodes.map(
          (n: any, idx: number) => n.label || n.title || n.id || `Tahap ${idx + 1}`,
        );
      } else if (
        Array.isArray(parsed.data.datasets?.[0]?.data) &&
        parsed.data.datasets[0].data.length > 0
      ) {
        const firstItem = parsed.data.datasets[0].data[0];
        if (typeof firstItem === 'object' && firstItem !== null) {
          const names = new Set<string>();
          parsed.data.datasets[0].data.forEach((d: any) => {
            if (d.from) names.add(String(d.from));
            if (d.to) names.add(String(d.to));
          });
          parsed.data.labels = Array.from(names).slice(0, 6);
        }
      }
    }

    // Jika tetap tidak ada label, buat label tahapan alur standar
    if (!Array.isArray(parsed.data.labels) || parsed.data.labels.length === 0) {
      parsed.data.labels = [
        'Tahap 1: Perencanaan & Regulasi',
        'Tahap 2: Sosialisasi & Koordinasi',
        'Tahap 3: Implementasi Lapangan',
        'Tahap 4: Monitoring & Evaluasi',
      ];
    }

    const labelCount = parsed.data.labels.length;
    const progressiveValues = [100, 85, 65, 45, 30, 20].slice(0, labelCount);
    while (progressiveValues.length < labelCount) {
      progressiveValues.push(50);
    }

    parsed.data.datasets = [
      {
        label: altText || 'Estimasi Progres Capaian (%)',
        data: progressiveValues,
        backgroundColor: [
          '#0f766e',
          '#0d9488',
          '#14b8a6',
          '#2dd4bf',
          '#5eead4',
          '#99f6e4',
        ].slice(0, labelCount),
      },
    ];
  }

  // 3. Validasi integritas struktur data
  if (!parsed.data || typeof parsed.data !== 'object') {
    return createDefaultBarChart(altText);
  }

  if (!Array.isArray(parsed.data.labels) || parsed.data.labels.length === 0) {
    parsed.data.labels = ['Indikator 1', 'Indikator 2', 'Indikator 3'];
  }

  // Bersihkan label dari kurung '(' ')' dan ampersand '&' agar aman bagi parser Markdown CommonMark
  parsed.data.labels = parsed.data.labels.map((l: any) =>
    String(l || '')
      .replace(/[()]/g, '-')
      .replace(/&/g, 'dan')
      .trim(),
  );

  if (!Array.isArray(parsed.data.datasets) || parsed.data.datasets.length === 0) {
    parsed.data.datasets = [
      {
        label: altText || 'Visualisasi Data',
        data: [70, 85, 75],
        backgroundColor: ['#0d9488', '#14b8a6', '#2dd4bf'],
      },
    ];
  } else {
    // Pastikan nilai data numerik dan bukan object/string rusak
    parsed.data.datasets.forEach((ds: any) => {
      if (ds.label) {
        ds.label = String(ds.label)
          .replace(/[()]/g, '-')
          .replace(/&/g, 'dan')
          .trim();
      }
      if (Array.isArray(ds.data)) {
        ds.data = ds.data.map((val: any) => {
          if (typeof val === 'number') return val;
          const num = parseFloat(String(val).replace(/[^0-9.-]/g, ''));
          return isNaN(num) ? 50 : num;
        });
      } else {
        ds.data = parsed.data.labels.map(() => 50);
      }
      if (!ds.backgroundColor) {
        ds.backgroundColor = ['#0f766e', '#0d9488', '#14b8a6', '#2dd4bf', '#5eead4'];
      }
    });
  }

  // 4. Opsi visual dan tipografi
  parsed.options.responsive = true;
  if (!parsed.options.plugins || typeof parsed.options.plugins !== 'object') {
    parsed.options.plugins = {};
  }
  if (!parsed.options.plugins.legend) {
    parsed.options.plugins.legend = { display: true };
  }
  if (!parsed.options.plugins.title) {
    parsed.options.plugins.title = {
      display: true,
      text: altText || 'Visualisasi Data BRIDA',
    };
  }

  return parsed;
}

function createDefaultBarChart(altText: string): any {
  return {
    type: 'bar',
    data: {
      labels: ['Indikator 1', 'Indikator 2', 'Indikator 3'],
      datasets: [
        {
          label: altText || 'Visualisasi Data',
          data: [70, 85, 75],
          backgroundColor: ['#0d9488', '#14b8a6', '#2dd4bf'],
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: true },
        title: { display: true, text: altText || 'Visualisasi Data' },
      },
    },
  };
}

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

  if (objStart !== -1) {
    return {
      objectStr: str.substring(objStart),
      endIndex: str.length,
    };
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

  // 2. Amankan karakter % liar yang tidak valid sebelum decodeURIComponent
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

/**
 * Helper untuk meng-encode JSON Chart.js ke URL query parameter yang aman 100%
 * untuk parser Markdown (CommonMark/GFM) dan browser HTTP GET request.
 */
function safeUrlEncodeChartConfig(jsonStr: string): string {
  return encodeURIComponent(jsonStr)
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29')
    .replace(/'/g, '%27')
    .replace(/\*/g, '%2A');
}

export function sanitizeQuickChartMarkdown(markdown: string): string {
  if (!markdown || typeof markdown !== 'string') return '';

  let result = markdown;
  const qcMarker = 'quickchart.io/chart';
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
    let isMarkdownImage = false;

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
        isMarkdownImage = true;
        if (m[2] && m[2].trim()) {
          altText = m[2].trim().replace(/[\[\]]/g, '');
        }
      }
    }

    // 2. Cari parameter c= atau chart=
    const afterQc = result.substring(foundIdx + qcMarker.length);
    const cMatch = afterQc.match(/^(?:\?[^ \n\r"'>]*?[?&]|\?)?(c|chart)=/i);

    if (cMatch) {
      const cStart = foundIdx + qcMarker.length + cMatch[0].length;
      // Ambil hingga 4000 karakter ke depan untuk menemukan objek JSON lengkap melintasi baris baru
      const lookahead = result.substring(cStart, cStart + 4000);

      // Cari kurung kurawal pertama (baik decoded '{' atau encoded '%7B')
      const braceOffset = lookahead.indexOf('{');
      const encodedBraceOffset = lookahead.search(/%7B/i);

      let configStr = '';
      let rawConsumedLength = 0;

      if (encodedBraceOffset !== -1 && (braceOffset === -1 || encodedBraceOffset < braceOffset)) {
        // Percent-encoded chunk: temukan akhir parameter (sampai &bkg, &w, atau penutup ')')
        let paramEnd = lookahead.search(/[&\)\s\n\r"'>]/);
        if (paramEnd === -1) paramEnd = lookahead.length;
        const rawEncoded = lookahead.substring(0, paramEnd);
        const decoded = safelyDecodeChartConfig(rawEncoded);
        const b = extractBalancedObject(decoded, 0);
        if (b) {
          configStr = b.objectStr;
          rawConsumedLength = paramEnd;
        }
      }

      if (!configStr && braceOffset !== -1) {
        // Unencoded JSON melintasi baris baru
        const b = extractBalancedObject(lookahead, braceOffset);
        if (b) {
          configStr = b.objectStr;
          rawConsumedLength = b.endIndex;
        }
      }

      if (configStr) {
        let replaceEnd = cStart + rawConsumedLength;

        // Jika berada di dalam tag Markdown ![alt](url), cari tanda kurung penutup ')' setelah JSON
        if (isMarkdownImage) {
          const afterJson = result.substring(replaceEnd);
          const closeParenIdx = afterJson.indexOf(')');
          if (closeParenIdx !== -1 && closeParenIdx < 300) {
            const inBetween = afterJson.substring(0, closeParenIdx);
            if (!inBetween.includes('\n\n') && !inBetween.includes('![')) {
              replaceEnd = replaceEnd + closeParenIdx + 1;
            }
          }
        }

        let finalJson = '';
        try {
          const repaired = jsonrepair(configStr);
          const parsed = JSON.parse(repaired);
          const normalized = normalizeChartConfig(parsed, altText);
          finalJson = JSON.stringify(normalized);
        } catch {
          finalJson = JSON.stringify(createDefaultBarChart(altText));
        }

        const safeEncoded = safeUrlEncodeChartConfig(finalJson);
        const safeUrl = `https://quickchart.io/chart?v=3&c=${safeEncoded}&bkg=white&w=650&h=350&devicePixelRatio=2`;
        const replacement = `\n\n![${altText}](${safeUrl})\n\n`;

        result = result.substring(0, fullMatchStart) + replacement + result.substring(replaceEnd);
        searchPos = fullMatchStart + replacement.length;
        continue;
      }
    }

    searchPos = foundIdx + qcMarker.length;
  }

  return result.replace(/\n{3,}/g, '\n\n');
}
