export interface ArtDirectorOutputDto {
  aiCommentary: string;
  posterTitle: string;
  visualMetaphor: string;
  colorScheme: string;
  extractedKeyFacts: string[];
  imagePrompt: string;
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
        'Respon penjelasan singkat, solutif, dan profesional dalam Bahasa Indonesia (maksimal 2-3 kalimat) mengenai konsep visual dan data yang dirangkum. DILARANG mengajukan pertanyaan klarifikasi balik!',
    },
    posterTitle: {
      type: 'string',
      description: 'Judul resmi poster 100% Bahasa Indonesia (maksimal 6-8 kata, formal dan padat).',
    },
    visualMetaphor: {
      type: 'string',
      description:
        'Penjelasan konsep gaya visual metafora yang dipilih (misal: 3D Minimal Healthcare/Nutrition, Corporate Financial, atau Civil Engineering).',
    },
    colorScheme: {
      type: 'string',
      description: 'Palet warna dominan (misal: Warm Teal & Gold, Deep Navy & Champagne Gold).',
    },
    extractedKeyFacts: {
      type: 'array',
      items: { type: 'string' },
      description: 'Daftar 2-3 angka atau fakta kunci riil yang dikutip dari dokumen BRIDA atau data internet.',
    },
    imagePrompt: {
      type: 'string',
      description:
        'Prompt visual Bahasa Inggris sangat detail untuk DALL-E 3 yang memuat komposisi, tipografi utama berbahasa Indonesia, pencahayaan studio 8k, dan metafora visual yang relevan.',
    },
  },
};

