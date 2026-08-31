import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { AdminMasterService } from './admin-master.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('districts')
@UseGuards(JwtAuthGuard) // Terbuka untuk seluruh pengguna terautentikasi (USER & ADMIN)
export class DistrictsController {
  constructor(private readonly adminMasterService: AdminMasterService) {}

  @Get()
  async getAllDistricts() {
    const data = await this.adminMasterService.getAllDistricts();
    return { success: true, data };
  }

  @Get(':id')
  async getDistrictById(@Param('id') id: string) {
    const data = await this.adminMasterService.getDistrictById(id);
    return { success: true, data };
  }
}
