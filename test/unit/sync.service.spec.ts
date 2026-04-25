import { Test, TestingModule } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import { SyncService } from '../../src/sync/sync.service';
import { BalanceService } from '../../src/balance/balance.service';
import { RequestService } from '../../src/request/request.service';
import { LeaveBalance } from '../../src/balance/entities/leave-balance.entity';
import { ChangeSource } from '../../src/common/enums';

describe('SyncService', () => {
  let service: SyncService;
  let balanceService: any;
  let requestService: any;
  let dataSource: any;

  const mockBalanceService = {
    upsertBalance: jest.fn(),
    getAvailableBalance: jest.fn(),
  };

  const mockRequestService = {
    flagInvalidPendingRequests: jest.fn(),
  };

  const mockDataSource = {
    createQueryRunner: jest.fn(),
    manager: {
      findOne: jest.fn(),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        SyncService,
        { provide: BalanceService, useValue: mockBalanceService },
        { provide: RequestService, useValue: mockRequestService },
        { provide: DataSource, useValue: mockDataSource },
      ],
    }).compile();

    service = module.get<SyncService>(SyncService);
    balanceService = mockBalanceService;
    requestService = mockRequestService;
    dataSource = mockDataSource;

    jest.clearAllMocks();
  });

  describe('batchSync', () => {
    it('should upsert all balances in batch', async () => {
      const dto = {
        balances: [
          { employeeId: 'emp_1', locationId: 'loc_1', leaveType: 'PTO', balanceDays: 10 },
          { employeeId: 'emp_2', locationId: 'loc_1', leaveType: 'PTO', balanceDays: 5 },
        ],
      };

      dataSource.manager.findOne.mockResolvedValue(null); // all new
      balanceService.upsertBalance.mockResolvedValue({});
      requestService.flagInvalidPendingRequests.mockResolvedValue(0);

      const result = await service.batchSync(dto);

      expect(result.processed).toBe(2);
      expect(balanceService.upsertBalance).toHaveBeenCalledTimes(2);
      expect(balanceService.upsertBalance).toHaveBeenCalledWith(
        'emp_1', 'loc_1', 'PTO', 10, ChangeSource.HCM_BATCH, 'batch-sync',
      );
    });

    it('should flag invalid pending requests after sync', async () => {
      const dto = {
        balances: [
          { employeeId: 'emp_1', locationId: 'loc_1', leaveType: 'PTO', balanceDays: 2 },
        ],
      };

      dataSource.manager.findOne.mockResolvedValue({ balanceDays: 10 }); // existing
      balanceService.upsertBalance.mockResolvedValue({});
      requestService.flagInvalidPendingRequests.mockResolvedValue(1);

      const result = await service.batchSync(dto);

      expect(result.flaggedRequests).toBe(1);
      expect(requestService.flagInvalidPendingRequests).toHaveBeenCalledWith(
        'emp_1', 'loc_1', 'PTO',
      );
    });

    it('should handle empty batch', async () => {
      const result = await service.batchSync({ balances: [] });

      expect(result.processed).toBe(0);
      expect(balanceService.upsertBalance).not.toHaveBeenCalled();
    });

    it('should deduplicate combos for flagging', async () => {
      const dto = {
        balances: [
          { employeeId: 'emp_1', locationId: 'loc_1', leaveType: 'PTO', balanceDays: 10 },
          { employeeId: 'emp_1', locationId: 'loc_1', leaveType: 'PTO', balanceDays: 12 },
        ],
      };

      dataSource.manager.findOne.mockResolvedValue({ balanceDays: 5 });
      balanceService.upsertBalance.mockResolvedValue({});
      requestService.flagInvalidPendingRequests.mockResolvedValue(0);

      await service.batchSync(dto);

      // Should only flag once per unique combo
      expect(requestService.flagInvalidPendingRequests).toHaveBeenCalledTimes(1);
    });
  });

  describe('realtimeSync', () => {
    it('should update balance and return previous/new values', async () => {
      balanceService.getAvailableBalance.mockResolvedValue(10);
      balanceService.upsertBalance.mockResolvedValue({});
      requestService.flagInvalidPendingRequests.mockResolvedValue(0);

      const result = await service.realtimeSync({
        employeeId: 'emp_1',
        locationId: 'loc_1',
        leaveType: 'PTO',
        balanceDays: 13,
        reason: 'WORK_ANNIVERSARY',
      });

      expect(result.previousBalance).toBe(10);
      expect(result.newBalance).toBe(13);
      expect(result.changeSource).toBe('HCM_REALTIME');
      expect(balanceService.upsertBalance).toHaveBeenCalledWith(
        'emp_1', 'loc_1', 'PTO', 13, ChangeSource.HCM_REALTIME, 'WORK_ANNIVERSARY',
      );
    });

    it('should flag pending requests after balance decrease', async () => {
      balanceService.getAvailableBalance.mockResolvedValue(10);
      balanceService.upsertBalance.mockResolvedValue({});
      requestService.flagInvalidPendingRequests.mockResolvedValue(2);

      const result = await service.realtimeSync({
        employeeId: 'emp_1',
        locationId: 'loc_1',
        leaveType: 'PTO',
        balanceDays: 3,
      });

      expect(requestService.flagInvalidPendingRequests).toHaveBeenCalled();
    });
  });

  describe('getSyncStatus', () => {
    it('should return null timestamps initially', () => {
      const status = service.getSyncStatus();

      expect(status.lastBatchSyncAt).toBeNull();
      expect(status.lastBatchRecordCount).toBe(0);
      expect(status.lastRealtimeSyncAt).toBeNull();
    });

    it('should update after batch sync', async () => {
      dataSource.manager.findOne.mockResolvedValue(null);
      balanceService.upsertBalance.mockResolvedValue({});
      requestService.flagInvalidPendingRequests.mockResolvedValue(0);

      await service.batchSync({
        balances: [{ employeeId: 'emp_1', locationId: 'loc_1', leaveType: 'PTO', balanceDays: 10 }],
      });

      const status = service.getSyncStatus();
      expect(status.lastBatchSyncAt).toBeTruthy();
      expect(status.lastBatchRecordCount).toBe(1);
    });

    it('should update after realtime sync', async () => {
      balanceService.getAvailableBalance.mockResolvedValue(0);
      balanceService.upsertBalance.mockResolvedValue({});
      requestService.flagInvalidPendingRequests.mockResolvedValue(0);

      await service.realtimeSync({
        employeeId: 'emp_1',
        locationId: 'loc_1',
        leaveType: 'PTO',
        balanceDays: 10,
      });

      const status = service.getSyncStatus();
      expect(status.lastRealtimeSyncAt).toBeTruthy();
    });
  });
});
