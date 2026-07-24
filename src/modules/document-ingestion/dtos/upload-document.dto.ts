import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class UploadDocumentDto {
  @IsString()
  @IsNotEmpty({ message: 'Judul laporan tidak boleh kosong' })
  title!: string;

  @IsString()
  @IsOptional()
  category?: string;

  @IsString()
  @IsOptional()
  uploadedBy?: string;

  @IsString()
  @IsOptional()
  docType?: string; // 'BASELINE' | 'REALIZATION' | 'GENERAL_REFERENCE'
}
