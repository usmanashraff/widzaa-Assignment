import { Module } from '@nestjs/common';
import { SyncService } from './sync.service';
import { SyncController } from './sync.controller';
import { BalanceModule } from '../balance/balance.module';
import { RequestModule } from '../request/request.module';

@Module({
  imports: [BalanceModule, RequestModule],
  controllers: [SyncController],
  providers: [SyncService],
})
export class SyncModule {}
