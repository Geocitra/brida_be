import { Injectable, NotFoundException, OnModuleInit, Logger } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';

@Injectable()
export class SystemSettingService implements OnModuleInit {
  private readonly logger = new Logger(SystemSettingService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    try {
      const existingBupati = await this.prisma.systemSetting.findUnique({
        where: { key: 'BUPATI_NAME' },
      });

      // Update atau buat default Bupati resmi Mimika: Johannes Rettob, S.Sos., M.M.
      if (!existingBupati || existingBupati.value.includes('Darius')) {
        await this.prisma.systemSetting.upsert({
          where: { key: 'BUPATI_NAME' },
          update: { value: 'Johannes Rettob, S.Sos., M.M.' },
          create: { key: 'BUPATI_NAME', value: 'Johannes Rettob, S.Sos., M.M.' },
        });
        this.logger.log('[SystemSetting] Profil Bupati Mimika (Johannes Rettob, S.Sos., M.M.) berhasil diset.');
      }

      const existingPhone = await this.prisma.systemSetting.findUnique({
        where: { key: 'BUPATI_PHONE' },
      });
      if (!existingPhone) {
        await this.prisma.systemSetting.create({
          data: { key: 'BUPATI_PHONE', value: '628123456789' },
        });
      }
    } catch (err: any) {
      this.logger.warn(`[SystemSetting] Auto-init error: ${err.message}`);
    }
  }

  async getAllSettings() {
    return this.prisma.systemSetting.findMany({
      orderBy: { key: 'asc' },
    });
  }

  async getSettingByKey(key: string) {
    const setting = await this.prisma.systemSetting.findUnique({
      where: { key },
    });
    if (!setting) {
      throw new NotFoundException(`Pengaturan dengan key '${key}' tidak ditemukan.`);
    }
    return setting;
  }

  async updateSetting(key: string, value: string) {
    return this.prisma.systemSetting.upsert({
      where: { key },
      update: { value },
      create: { key, value },
    });
  }
}
