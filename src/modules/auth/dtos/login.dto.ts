import { IsString, IsNotEmpty, MinLength } from 'class-validator';

export class LoginDto {
  @IsString()
  @IsNotEmpty({ message: 'NIP / Identitas tidak boleh kosong' })
  nip!: string;

  @IsString()
  @IsNotEmpty({ message: 'Kata sandi tidak boleh kosong' })
  @MinLength(6, { message: 'Kata sandi minimal 6 karakter' })
  password!: string;
}