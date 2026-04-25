import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { HcmService } from './hcm.service';
import { HCM_SERVICE } from './hcm.interface';

@Module({
  imports: [ConfigModule],
  providers: [
    {
      provide: HCM_SERVICE,
      useClass: HcmService,
    },
  ],
  exports: [HCM_SERVICE],
})
export class HcmModule {}
