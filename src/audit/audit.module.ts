import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditService } from './audit.service';
import { BalanceAuditLog } from './entities/balance-audit-log.entity';

@Module({
  imports: [TypeOrmModule.forFeature([BalanceAuditLog])],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
