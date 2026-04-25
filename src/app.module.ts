import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { BalanceModule } from './balance/balance.module';
import { RequestModule } from './request/request.module';
import { SyncModule } from './sync/sync.module';
import { AuditModule } from './audit/audit.module';
import { HcmModule } from './hcm/hcm.module';
import { LeaveBalance } from './balance/entities/leave-balance.entity';
import { TimeOffRequest } from './request/entities/time-off-request.entity';
import { BalanceAuditLog } from './audit/entities/balance-audit-log.entity';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRoot({
      type: 'better-sqlite3',
      database: process.env.DB_PATH || 'timeoff.db',
      entities: [LeaveBalance, TimeOffRequest, BalanceAuditLog],
      synchronize: true, // Auto-create tables (dev only)
    }),
    BalanceModule,
    RequestModule,
    SyncModule,
    AuditModule,
    HcmModule,
  ],
})
export class AppModule {}
