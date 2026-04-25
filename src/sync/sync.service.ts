import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { LeaveBalance } from '../balance/entities/leave-balance.entity';
import { BalanceService } from '../balance/balance.service';
import { RequestService } from '../request/request.service';
import { ChangeSource } from '../common/enums';
import { BatchSyncDto, RealtimeSyncDto } from './dto';

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);
  private lastBatchSyncAt: Date | null = null;
  private lastBatchRecordCount: number = 0;
  private lastRealtimeSyncAt: Date | null = null;

  constructor(
    private balanceService: BalanceService,
    private requestService: RequestService,
    private dataSource: DataSource,
  ) {}

  async batchSync(dto: BatchSyncDto): Promise<any> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      let flaggedRequests = 0;
      const uniqueCombos = new Set<string>();

      // Count existing before upsert for created/updated stats
      let existingBefore = 0;
      for (const item of dto.balances) {
        const existing = await queryRunner.manager.findOne(LeaveBalance, {
          where: {
            employeeId: item.employeeId,
            locationId: item.locationId,
            leaveType: item.leaveType,
          },
        });
        if (existing) existingBefore++;
      }

      // Upsert all balances
      for (const item of dto.balances) {
        await this.balanceService.upsertBalance(
          item.employeeId,
          item.locationId,
          item.leaveType,
          item.balanceDays,
          ChangeSource.HCM_BATCH,
          'batch-sync',
          queryRunner.manager,
        );
        uniqueCombos.add(`${item.employeeId}|${item.locationId}|${item.leaveType}`);
      }

      // Check PENDING requests for each affected combo
      for (const combo of uniqueCombos) {
        const [employeeId, locationId, leaveType] = combo.split('|');
        const flagged = await this.requestService.flagInvalidPendingRequests(
          employeeId,
          locationId,
          leaveType,
          queryRunner.manager,
        );
        flaggedRequests += flagged;
      }

      const created = dto.balances.length - existingBefore;
      const updated = existingBefore;

      this.lastBatchSyncAt = new Date();
      this.lastBatchRecordCount = dto.balances.length;

      await queryRunner.commitTransaction();

      this.logger.log(
        `Batch sync complete: ${created} created, ${updated} updated, ${flaggedRequests} requests flagged`,
      );

      return { processed: dto.balances.length, created, updated, flaggedRequests };
    } catch (error) {
      await queryRunner.rollbackTransaction();
      this.logger.error(`Batch sync failed: ${error.message}`);
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async realtimeSync(dto: RealtimeSyncDto): Promise<any> {
    const currentAvailable = await this.balanceService.getAvailableBalance(
      dto.employeeId,
      dto.locationId,
      dto.leaveType,
    );

    await this.balanceService.upsertBalance(
      dto.employeeId,
      dto.locationId,
      dto.leaveType,
      dto.balanceDays,
      ChangeSource.HCM_REALTIME,
      dto.reason || 'realtime-sync',
    );

    // Check PENDING requests
    const flagged = await this.requestService.flagInvalidPendingRequests(
      dto.employeeId,
      dto.locationId,
      dto.leaveType,
    );

    if (flagged > 0) {
      this.logger.warn(
        `${flagged} pending requests flagged after realtime sync for ${dto.employeeId}`,
      );
    }

    this.lastRealtimeSyncAt = new Date();

    return {
      previousBalance: currentAvailable,
      newBalance: dto.balanceDays,
      changeSource: 'HCM_REALTIME',
    };
  }

  getSyncStatus() {
    return {
      lastBatchSyncAt: this.lastBatchSyncAt,
      lastBatchRecordCount: this.lastBatchRecordCount,
      lastRealtimeSyncAt: this.lastRealtimeSyncAt,
    };
  }
}
