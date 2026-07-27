export const ANALYSIS_OUTPUT_JSON_SCHEMA = {
  $schema: 'http://json-schema.org/draft-07/schema#',
  title: 'BridaReportAnalysisOutput',
  type: 'object',
  required: [
    'ringkasanEksekutif',
    'entitasTerlibat',
    'kronologiPeristiwa',
    'indikasiPelanggaran',
    'kesimpulanAnalisis',
  ],
  properties: {
    ringkasanEksekutif: {
      type: 'string',
      description: 'Ringkasan esensial laporan investigasi/kebijakan dalam 2-3 paragraf faktual.',
    },
    entitasTerlibat: {
      type: 'array',
      description: 'Daftar nama orang, instansi, atau perusahaan yang secara eksplisit disebutkan.',
      items: {
        type: 'object',
        required: ['nama', 'peran'],
        properties: {
          nama: { type: 'string', description: 'Nama entitas/individu/organisasi' },
          peran: { type: 'string', description: 'Peran atau jabatan dalam laporan' },
          entitasTerkait: { type: 'string', description: 'Instansi atau pihak terkait' },
        },
      },
    },
    kronologiPeristiwa: {
      type: 'array',
      description: 'Urutan kejadian atau kronologi fakta yang tercantum.',
      items: {
        type: 'object',
        required: ['deskripsi'],
        properties: {
          tanggal: { type: 'string', description: 'Tanggal atau periode waktu kejadian' },
          deskripsi: { type: 'string', description: 'Rincian peristiwa faktual' },
          lokasi: { type: 'string', description: 'Lokasi geografis kejadian jika ada' },
        },
      },
    },
    indikasiPelanggaran: {
      type: 'array',
      description: 'Daftar dugaan pelanggaran hukum, kebijakan, atau perbuatan melawan hukum.',
      items: {
        type: 'object',
        required: ['jenis', 'rincian'],
        properties: {
          jenis: { type: 'string', description: 'Jenis dugaan pelanggaran' },
          pasalDugaan: { type: 'string', description: 'Pasal atau aturan yang diduga dilanggar' },
          rincian: { type: 'string', description: 'Penjelasan faktual pendukung' },
        },
      },
    },
    kesimpulanAnalisis: {
      type: 'string',
      description: 'Rekomendasi akhir dan kesimpulan analis investigasi BRIDA.',
    },
  },
};
