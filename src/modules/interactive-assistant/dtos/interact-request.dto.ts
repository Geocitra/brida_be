import { IsString, IsNotEmpty, IsUUID, MinLength } from 'class-validator';

export class InteractRequestDto {
  @IsUUID('4', { message: 'sessionId harus berupa format UUID v4 yang valid' })
  @IsNotEmpty({ message: 'sessionId tidak boleh kosong' })
  sessionId!: string;

  @IsString()
  @IsNotEmpty({ message: 'Pesan atau perintah tidak boleh kosong' })
  @MinLength(2, { message: 'Pesan minimal 2 karakter' })
  query!: string;
}
