import { Controller, Get, Put, Body, Param, UseGuards } from '@nestjs/common';
import { SystemSettingService } from './system-setting.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '@prisma/client';

@Controller('admin')
export class SystemSettingController {
  constructor(private readonly settingService: SystemSettingService) {}

  // Endpoint publik: Dapat diakses oleh siapa saja (misal untuk modal share WA atau halaman publik)
  @Get('settings/public')
  async getPublicSettings() {
    const data = await this.settingService.getAllSettings();
    return { success: true, data };
  }

  @Get('settings')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async getAllSettings() {
    const data = await this.settingService.getAllSettings();
    return { success: true, data };
  }

  @Put('settings/:key')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.ADMIN)
  async updateSetting(
    @Param('key') key: string,
    @Body() body: { value: string },
  ) {
    const data = await this.settingService.updateSetting(key, body.value);
    return { success: true, data };
  }
}
