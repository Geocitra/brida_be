export const ARTICLE_OUTLINE_JSON_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'ArticleOutlineOutput',
  type: 'object',
  required: ['judulUsulan', 'tesisUtama', 'subArgumen', 'kesimpulanRingkas'],
  properties: {
    judulUsulan: {
      type: 'string',
      description: 'Judul artikel analitis/opini yang menarik dan profesional.',
    },
    tesisUtama: {
      type: 'string',
      description: 'Pernyataan tesis utama berbasis data dokumen laporan.',
    },
    subArgumen: {
      type: 'array',
      description: 'Daftar 3-4 poin sub-argumen logis.',
      items: {
        type: 'object',
        required: ['poin', 'faktaPendukung'],
        properties: {
          poin: { type: 'string', description: 'Judul sub-argumen/paragraf' },
          faktaPendukung: { type: 'string', description: 'Kutipan fakta dari dokumen' },
        },
      },
    },
    kesimpulanRingkas: {
      type: 'string',
      description: 'Kesimpulan dan rekomendasi aksi.',
    },
  },
};

export interface ArticleOutlineDto {
  judulUsulan: string;
  tesisUtama: string;
  subArgumen: Array<{
    poin: string;
    faktaPendukung: string;
  }>;
  kesimpulanRingkas: string;
}
