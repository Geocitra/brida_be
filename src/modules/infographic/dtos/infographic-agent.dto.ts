import { IsString, IsNotEmpty, IsOptional, IsIn, IsUUID } from 'class-validator';
import { PosterAspectRatio } from '../interfaces/image-generator.interface';

export class CreateInfographicSessionDto {
  @IsString({ message: 'Topik poster wajib diisi.' })
  @IsNotEmpty({ message: 'Topik poster tidak boleh kosong.' })
  topic!: string;

  @IsString()
  @IsOptional()
  title?: string;

  @IsUUID('4', { message: 'ID Dokumen harus berformat UUID v4 yang valid.' })
  @IsOptional()
  documentId?: string;

  @IsString()
  @IsOptional()
  @IsIn(['1:1', '9:16', '16:9', '3:4', '4:3'], {
    message: 'Aspek rasio harus bernilai 1:1, 9:16, 16:9, 3:4, atau 4:3.',
  })
  aspectRatio?: PosterAspectRatio = '9:16';

  @IsString()
  @IsOptional()
  customInstructions?: string;
}

export class ChatInfographicAgentDto {
  @IsUUID('4', { message: 'ID Sesi harus berformat UUID v4 yang valid.' })
  @IsNotEmpty({ message: 'ID Sesi wajib disertakan.' })
  sessionId!: string;

  @IsString({ message: 'Pesan instruksi atau revisi wajib diisi.' })
  @IsNotEmpty({ message: 'Pesan instruksi tidak boleh kosong.' })
  message!: string;

  @IsString()
  @IsOptional()
  @IsIn(['1:1', '9:16', '16:9', '3:4', '4:3'], {
    message: 'Aspek rasio harus bernilai 1:1, 9:16, 16:9, 3:4, atau 4:3.',
  })
  aspectRatio?: PosterAspectRatio;
}
