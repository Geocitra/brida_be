import { Injectable, Logger, UnauthorizedException, OnModuleInit } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../../common/prisma/prisma.service';
import { LoginDto } from '../dtos/login.dto';
import { UserRole } from '@prisma/client';
import * as bcrypt from 'bcrypt';

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  // Seeding otomatis akun default (Kepala BRIDA & Admin) jika belum ada di database
  async onModuleInit() {
    try {
      const saltRounds = 10;

      // 1. Akun Kepala BRIDA (USER)
      const defaultNip = '197804122003121002';
      const existingUser = await this.prisma.user.findUnique({
        where: { nip: defaultNip },
      });

      if (!existingUser) {
        const defaultPassword = 'password123';
        const passwordHash = await bcrypt.hash(defaultPassword, saltRounds);

        await this.prisma.user.create({
          data: {
            nip: defaultNip,
            fullName: 'Darius Sabon Rain, S.E., M.Ec.Dev.',
            passwordHash,
            role: UserRole.USER,
          },
        });
        this.logger.log(`[Auth Seeder] Akun default Kepala BRIDA (NIP: ${defaultNip}) berhasil diinisialisasi.`);
      }

      // 2. Akun Administrator (ADMIN)
      const adminNip = 'admin123';
      const existingAdmin = await this.prisma.user.findFirst({
        where: { nip: { equals: adminNip, mode: 'insensitive' } },
      });

      if (!existingAdmin) {
        const adminPassword = 'passwordadmin';
        const adminPasswordHash = await bcrypt.hash(adminPassword, saltRounds);

        await this.prisma.user.create({
          data: {
            nip: adminNip,
            fullName: 'Administrator BRIDA',
            passwordHash: adminPasswordHash,
            role: UserRole.ADMIN,
          },
        });
        this.logger.log(`[Auth Seeder] Akun default Administrator (NIP: ${adminNip}) berhasil diinisialisasi.`);
      }
    } catch (err: any) {
      this.logger.error(`[Auth Seeder Error] Gagal melakukan seeding akun default: ${err.message}`);
    }
  }

  async login(dto: LoginDto): Promise<{ accessToken: string; executive: { nip: string; fullName: string; role: UserRole } }> {
    const { nip, password } = dto;
    const cleanNip = nip.replace(/\s+/g, '').trim();

    let user = await this.prisma.user.findUnique({
      where: { nip: cleanNip },
    });

    // Fallback: pencarian case-insensitive jika NIP mengandung teks (seperti admin123)
    if (!user) {
      user = await this.prisma.user.findFirst({
        where: {
          nip: {
            equals: cleanNip,
            mode: 'insensitive',
          },
        },
      });
    }

    if (!user) {
      this.logger.warn(`[Login Failed] NIP tidak ditemukan: ${nip}`);
      throw new UnauthorizedException('NIP atau Kata Sandi Otorisasi salah.');
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);
    if (!isPasswordValid) {
      this.logger.warn(`[Login Failed] Password salah untuk NIP: ${nip}`);
      throw new UnauthorizedException('NIP atau Kata Sandi Otorisasi salah.');
    }

    const payload = { sub: user.id, nip: user.nip, fullName: user.fullName, role: user.role };
    const accessToken = this.jwtService.sign(payload);

    this.logger.log(`[Login Success] ${user.role} (${user.fullName}) berhasil masuk sistem.`);

    return {
      accessToken,
      executive: {
        nip: user.nip,
        fullName: user.fullName,
        role: user.role,
      },
    };
  }
}