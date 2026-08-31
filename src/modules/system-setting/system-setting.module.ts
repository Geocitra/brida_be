import { Module } from '@nestjs/common';
import { SystemSettingService } from './system-setting.service';
import { SystemSettingController } from './system-setting.controller';
import { PrismaModule } from '../../common/prisma/prisma.module';

@Module({
  imports: [PrismaModule],
  providers: [SystemSettingService],
  controllers: [SystemSettingController],
  exports: [SystemSettingService],
})
export class SystemSettingModule {}
