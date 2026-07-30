import { Injectable, Logger, UnauthorizedException, OnModuleInit } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { LoginDto } from '../dtos/login.dto';
import * as bcrypt from 'bcrypt';

@Injectable( )
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  // Seeding otomatis akun Kepala BRIDA jika belum ada di database
  async onModuleInit() {
    try {
      const defaultNip = '197804122003121002';
      const existingUser = await this.prisma.executiveUser.findUnique({
        where: { nip: defaultNip },
      });

      if (!existingUser) {
        const saltRounds = 10;
        const defaultPassword = 'password123'; // Password default awal
        const passwordHash = await bcrypt.hash(defaultPassword, saltRounds);

        await this.prisma.executiveUser.create({
          data: {
            nip: defaultNip,
            fullName: 'Darius Sabon Rain, S.E., M.Ec.Dev.',
            passwordHash,
          },
        });
        this.logger.log(`[Auth Seeder] Akun default Kepala BRIDA (NIP: ${defaultNip}) berhasil diinisialisasi.`);
      }
    } catch (err: any) {
      this.logger.error(`[Auth Seeder Error] Gagal melakukan seeding akun default: ${err.message}`);
    }
  }

  async login(dto: LoginDto): Promise<{ accessToken: string; executive: { nip: string; fullName: string } }> {
    const { nip, password } = dto;
    const cleanNip = nip.replace(/\s+/g, '').trim();

    const user = await this.prisma.executiveUser.findUnique({
      where: { nip: cleanNip },
    });

    if (!user) {
      this.logger.warn(`[Login Failed] NIP tidak ditemukan: ${nip}`);
      throw new UnauthorizedException('NIP atau Kata Sandi Otorisasi salah.');
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      this.logger.warn(`[Login Failed] Password salah untuk NIP: ${nip}`);
      throw new UnauthorizedException('NIP atau Kata Sandi Otorisasi salah.');
    }

    const payload = { sub: user.id, nip: user.nip, fullName: user.fullName };
    const accessToken = this.jwtService.sign(payload);

    this.logger.log(`[Login Success] Kepala BRIDA (${user.fullName}) berhasil masuk sistem.`);

    return {
      accessToken,
      executive: {
        nip: user.nip,
        fullName: user.fullName,
      },
    };
  }
}