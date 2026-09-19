export interface ArtDirectorOutputDto {
  aiCommentary: string;
  posterTitle: string;
  visualMetaphor: string;
  colorScheme: string;
  extractedKeyFacts: ExtractedKeyFact[];
  imagePrompt: string;
}

export interface ExtractedKeyFact {
  value: string;
  label: string;
  source: string;
  confidence: 'grounded' | 'estimated';
}

export const ART_DIRECTOR_OUTPUT_SCHEMA = {
  type: 'object',
  required: [
    'aiCommentary',
    'posterTitle',
    'visualMetaphor',
    'colorScheme',
    'extractedKeyFacts',
    'imagePrompt',
  ],
  properties: {
    aiCommentary: {
      type: 'string',
      description:
        'Penjelasan singkat dalam Bahasa Indonesia (2-3 kalimat) mengenai arsitektur informasi visual, zone composition strategy, dan angka penting yang disintesis dari data riil. DILARANG mengajukan pertanyaan balik.',
    },
    posterTitle: {
      type: 'string',
      description: 'Judul resmi poster 100% Bahasa Indonesia formal (maksimal 6-8 kata).',
    },
    visualMetaphor: {
      type: 'string',
      description:
        'Penjelasan gaya tata letak infografis yang dipilih (misal: Dense Editorial Data Infographic, Documentary-Driven Government Report, dll.).',
    },
    colorScheme: {
      type: 'string',
      description: 'Palet warna dominan yang digunakan (misal: Deep Navy #0F1E36, Teal #0D9488, Amber #F59E0B).',
    },
    extractedKeyFacts: {
      type: 'array',
      items: {
        type: 'object',
        required: ['value', 'label', 'source', 'confidence'],
        properties: {
          value: {
            type: 'string',
            description: 'Nilai numerik atau persentase fakta kunci (misal: "24.2%", "Rp 1.3 Triliun", "487 km").',
          },
          label: {
            type: 'string',
            description: 'Label deskriptif singkat Bahasa Indonesia (misal: "Prevalensi Stunting", "Pagu APBD Infrastruktur").',
          },
          source: {
            type: 'string',
            description: 'Sumber asal data (misal: "BPS Mimika 2025", "Laporan Ketahanan Pangan BRIDA", "Estimasi indikator baku").',
          },
          confidence: {
            type: 'string',
            enum: ['grounded', 'estimated'],
            description: '"grounded" jika diambil langsung dari data yang disediakan. "estimated" jika merupakan estimasi wajar karena data eksak tidak tersedia.',
          },
        },
      },
      description: 'Daftar 3-6 fakta angka kunci dengan provenance (sumber, tingkat kepercayaan). Setiap angka yang muncul pada gambar WAJIB terdaftar di sini.',
    },
    imagePrompt: {
      type: 'string',
      description:
        'Prompt visual detail dalam Bahasa Inggris untuk DALL-E 3 / Image AI yang memuat: (1) komposisi 7 visual zones beserta alokasi tinggi kanvas, (2) palet warna tematik, (3) instruksi teks 100% Bahasa Indonesia pada gambar, (4) instruksi tanpa logo/watermark, dan (5) instruksi penutup resolusi 8k. Prompt harus menghasilkan komposisi dense yang memenuhi 92-97% kanvas.',
    },
  },
};
