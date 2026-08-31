import { Module } from '@nestjs/common';
import { AdminMasterController } from './admin-master.controller';
import { DistrictsController } from './districts.controller';
import { AdminMasterService } from './admin-master.service';

@Module({
  controllers: [AdminMasterController, DistrictsController],
  providers: [AdminMasterService],
  exports: [AdminMasterService],
})
export class AdminMasterModule {}
