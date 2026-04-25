import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BalanceAuditLog } from './entities/balance-audit-log.entity';
import { ChangeSource } from '../common/enums';

@Injectable()
export class AuditService {
  constructor(
    @InjectRepository(BalanceAuditLog)
    private auditRepo: Repository<BalanceAuditLog>,
  ) {}

  async log(params: Partial<BalanceAuditLog> & { changeSource: ChangeSource }, manager?: any): Promise<BalanceAuditLog> {
    const repo = manager ? manager.getRepository(BalanceAuditLog) : this.auditRepo;
    const logEntry = repo.create(params);
    return repo.save(logEntry);
  }

  async findByEmployee(employeeId: string): Promise<BalanceAuditLog[]> {
    return this.auditRepo.find({
      where: { employeeId },
      order: { createdAt: 'DESC' },
    });
  }

  async findByEmployeeAndLocation(
    employeeId: string,
    locationId: string,
  ): Promise<BalanceAuditLog[]> {
    return this.auditRepo.find({
      where: { employeeId, locationId },
      order: { createdAt: 'DESC' },
    });
  }
}
