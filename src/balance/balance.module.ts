import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { BalanceService } from './balance.service';
import { BalanceController } from './balance.controller';
import { LeaveBalance } from './entities/leave-balance.entity';
import { TimeOffRequest } from '../request/entities/time-off-request.entity';
import { AuditModule } from '../audit/audit.module';
import { HcmModule } from '../hcm/hcm.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([LeaveBalance, TimeOffRequest]),
    AuditModule,
    HcmModule,
    ConfigModule,
  ],
  controllers: [BalanceController],
  providers: [BalanceService],
  exports: [BalanceService],
})
export class BalanceModule {}
