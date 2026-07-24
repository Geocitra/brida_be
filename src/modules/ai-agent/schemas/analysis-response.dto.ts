export interface EntitasTerlibatDto {
  nama: string;
  peran: string;
  entitasTerkait?: string;
}

export interface KronologiPeristiwaDto {
  tanggal?: string;
  deskripsi: string;
  lokasi?: string;
}

export interface IndikasiPelanggaranDto {
  jenis: string;
  pasalDugaan?: string;
  rincian: string;
}

export interface AnalysisResponseDto {
  ringkasanEksekutif: string;
  entitasTerlibat: EntitasTerlibatDto[];
  kronologiPeristiwa: KronologiPeristiwaDto[];
  indikasiPelanggaran: IndikasiPelanggaranDto[];
  kesimpulanAnalisis: string;
}
