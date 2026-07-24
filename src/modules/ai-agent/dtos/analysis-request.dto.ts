import { IsString, IsNotEmpty, IsUUID, MinLength } from 'class-validator';

export class AnalysisRequestDto {
  @IsUUID('4', { message: 'documentId harus berupa format UUID v4 yang valid' })
  @IsNotEmpty({ message: 'documentId tidak boleh kosong' })
  documentId!: string;

  @IsString()
  @IsNotEmpty({ message: 'Query atau instruksi analisis tidak boleh kosong' })
  @MinLength(3, { message: 'Query minimal 3 karakter' })
  query!: string;
}
