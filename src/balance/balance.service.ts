import { Injectable, Inject, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { LeaveBalance } from './entities/leave-balance.entity';
import { TimeOffRequest } from '../request/entities/time-off-request.entity';
import { AuditService } from '../audit/audit.service';
import { ChangeSource, RequestStatus } from '../common/enums';
import { type IHcmService, HCM_SERVICE } from '../hcm/hcm.interface';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class BalanceService {
  private readonly logger = new Logger(BalanceService.name);
  private readonly stalenessThresholdMs: number;

  constructor(
    @InjectRepository(LeaveBalance)
    private balanceRepo: Repository<LeaveBalance>,
    @InjectRepository(TimeOffRequest)
    private requestRepo: Repository<TimeOffRequest>,
    @Inject(HCM_SERVICE)
    private hcmService: IHcmService,
    private auditService: AuditService,
    private configService: ConfigService,
  ) {
    this.stalenessThresholdMs = this.configService.get<number>(
      'STALENESS_THRESHOLD_MS',
      5 * 60 * 1000, // 5 minutes default
    );
  }

  async getBalances(employeeId: string): Promise<any> {
    const balances = await this.balanceRepo.find({ where: { employeeId } });

    const enriched = await Promise.all(
      balances.map(async (b) => {
        const pendingDays = await this.getPendingDays(
          b.employeeId,
          b.locationId,
          b.leaveType,
        );
        const isStale = this.isStale(b.lastSyncedAt);

        // Trigger background refresh if stale
        if (isStale) {
          this.refreshFromHcm(b.employeeId, b.locationId, b.leaveType).catch(
            (err) => this.logger.warn(`Background refresh failed: ${err.message}`),
          );
        }

        return {
          locationId: b.locationId,
          leaveType: b.leaveType,
          totalDays: Number(b.balanceDays),
          availableDays: Number(b.balanceDays) - pendingDays,
          pendingDays,
          lastSyncedAt: b.lastSyncedAt,
          stale: isStale,
        };
      }),
    );

    return { employeeId, balances: enriched };
  }

  async getBalance(employeeId: string, locationId: string): Promise<any> {
    const balances = await this.balanceRepo.find({
      where: { employeeId, locationId },
    });

    if (balances.length === 0) {
      return null;
    }

    const enriched = await Promise.all(
      balances.map(async (b) => {
        const pendingDays = await this.getPendingDays(
          b.employeeId,
          b.locationId,
          b.leaveType,
        );
        const isStale = this.isStale(b.lastSyncedAt);

        if (isStale) {
          this.refreshFromHcm(b.employeeId, b.locationId, b.leaveType).catch(
            (err) => this.logger.warn(`Background refresh failed: ${err.message}`),
          );
        }

        return {
          locationId: b.locationId,
          leaveType: b.leaveType,
          totalDays: Number(b.balanceDays),
          availableDays: Number(b.balanceDays) - pendingDays,
          pendingDays,
          lastSyncedAt: b.lastSyncedAt,
          stale: isStale,
        };
      }),
    );

    return { employeeId, balances: enriched };
  }

  async getAvailableBalance(
    employeeId: string,
    locationId: string,
    leaveType: string,
    manager?: any,
  ): Promise<number> {
    const repo = manager ? manager.getRepository(LeaveBalance) : this.balanceRepo;
    const balance = await repo.findOne({
      where: { employeeId, locationId, leaveType },
    });

    if (!balance) return 0;

    const pendingDays = await this.getPendingDays(employeeId, locationId, leaveType, manager);
    return Number(balance.balanceDays) - pendingDays;
  }

  async getPendingDays(
    employeeId: string,
    locationId: string,
    leaveType: string,
    manager?: any,
  ): Promise<number> {
    const repo = manager ? manager.getRepository(TimeOffRequest) : this.requestRepo;
    const result = await repo
      .createQueryBuilder('r')
      .select('COALESCE(SUM(r.days_requested), 0)', 'total')
      .where('r.employee_id = :employeeId', { employeeId })
      .andWhere('r.location_id = :locationId', { locationId })
      .andWhere('r.leave_type = :leaveType', { leaveType })
      .andWhere('r.status IN (:...statuses)', {
        statuses: [RequestStatus.PENDING, RequestStatus.PENDING_REVIEW],
      })
      .getRawOne();

    return Number(result?.total || 0);
  }

  async upsertBalance(
    employeeId: string,
    locationId: string,
    leaveType: string,
    balanceDays: number,
    changeSource: ChangeSource,
    referenceId?: string,
    manager?: any,
  ): Promise<LeaveBalance> {
    const repo = manager ? manager.getRepository(LeaveBalance) : this.balanceRepo;
    let balance = await repo.findOne({
      where: { employeeId, locationId, leaveType },
    });

    const previousBalance = balance ? Number(balance.balanceDays) : 0;

    if (balance) {
      balance.balanceDays = balanceDays;
      balance.lastSyncedAt = new Date();
    } else {
      balance = this.balanceRepo.create({
        employeeId,
        locationId,
        leaveType,
        balanceDays,
        lastSyncedAt: new Date(),
      });
    }

    const saved = await repo.save(balance);

    // Write audit log
    await this.auditService.log({
      employeeId,
      locationId,
      leaveType,
      previousBalance,
      newBalance: balanceDays,
      changeSource,
      referenceId,
    }, manager);

    return saved;
  }

  async deductBalance(
    employeeId: string,
    locationId: string,
    leaveType: string,
    days: number,
    referenceId: string,
  ): Promise<void> {
    const balance = await this.balanceRepo.findOne({
      where: { employeeId, locationId, leaveType },
    });

    if (!balance) {
      throw new Error('Balance not found');
    }

    const previousBalance = Number(balance.balanceDays);
    balance.balanceDays = previousBalance - days;
    await this.balanceRepo.save(balance);

    await this.auditService.log({
      employeeId,
      locationId,
      leaveType,
      previousBalance,
      newBalance: balance.balanceDays,
      changeSource: ChangeSource.REQUEST_APPROVED,
      referenceId,
    });
  }

  async restoreBalanceLocally(
    employeeId: string,
    locationId: string,
    leaveType: string,
    days: number,
    referenceId: string,
  ): Promise<void> {
    const balance = await this.balanceRepo.findOne({
      where: { employeeId, locationId, leaveType },
    });

    if (!balance) {
      throw new Error('Balance not found');
    }

    const previousBalance = Number(balance.balanceDays);
    balance.balanceDays = previousBalance + days;
    await this.balanceRepo.save(balance);

    await this.auditService.log({
      employeeId,
      locationId,
      leaveType,
      previousBalance,
      newBalance: balance.balanceDays,
      changeSource: ChangeSource.REQUEST_CANCELLED,
      referenceId,
    });
  }

  private isStale(lastSyncedAt: Date | null): boolean {
    if (!lastSyncedAt) return true;
    return Date.now() - new Date(lastSyncedAt).getTime() > this.stalenessThresholdMs;
  }

  private async refreshFromHcm(
    employeeId: string,
    locationId: string,
    leaveType: string,
  ): Promise<void> {
    try {
      const hcmBalance = await this.hcmService.verifyBalance(
        employeeId,
        locationId,
        leaveType,
      );
      await this.upsertBalance(
        employeeId,
        locationId,
        leaveType,
        hcmBalance.balanceDays,
        ChangeSource.HCM_REALTIME,
        'background-refresh',
      );
    } catch (error) {
      this.logger.warn(`Failed to refresh from HCM: ${error.message}`);
    }
  }
}
