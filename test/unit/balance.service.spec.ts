import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { BalanceService } from '../../src/balance/balance.service';
import { LeaveBalance } from '../../src/balance/entities/leave-balance.entity';
import { TimeOffRequest } from '../../src/request/entities/time-off-request.entity';
import { AuditService } from '../../src/audit/audit.service';
import { HCM_SERVICE } from '../../src/hcm/hcm.interface';
import { ChangeSource, RequestStatus } from '../../src/common/enums';

describe('BalanceService', () => {
  let service: BalanceService;
  let balanceRepo: any;
  let requestRepo: any;
  let hcmService: any;
  let auditService: any;

  const mockBalanceRepo = {
    find: jest.fn(),
    findOne: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
  };

  const mockRequestRepo = {
    createQueryBuilder: jest.fn(),
  };

  const mockHcmService = {
    verifyBalance: jest.fn(),
    fileDeduction: jest.fn(),
    restoreBalance: jest.fn(),
  };

  const mockAuditService = {
    log: jest.fn(),
  };

  const mockConfigService = {
    get: jest.fn().mockReturnValue(300000), // 5 min staleness
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        BalanceService,
        { provide: getRepositoryToken(LeaveBalance), useValue: mockBalanceRepo },
        { provide: getRepositoryToken(TimeOffRequest), useValue: mockRequestRepo },
        { provide: HCM_SERVICE, useValue: mockHcmService },
        { provide: AuditService, useValue: mockAuditService },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<BalanceService>(BalanceService);
    balanceRepo = mockBalanceRepo;
    requestRepo = mockRequestRepo;
    hcmService = mockHcmService;
    auditService = mockAuditService;

    jest.clearAllMocks();
  });

  describe('getAvailableBalance', () => {
    it('should return 0 when no balance exists', async () => {
      balanceRepo.findOne.mockResolvedValue(null);

      const result = await service.getAvailableBalance('emp_1', 'loc_1', 'PTO');
      expect(result).toBe(0);
    });

    it('should return balance minus pending days', async () => {
      balanceRepo.findOne.mockResolvedValue({ balanceDays: 10 });

      const mockQb = {
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ total: 3 }),
      };
      requestRepo.createQueryBuilder.mockReturnValue(mockQb);

      const result = await service.getAvailableBalance('emp_1', 'loc_1', 'PTO');
      expect(result).toBe(7); // 10 - 3
    });

    it('should return full balance when no pending requests', async () => {
      balanceRepo.findOne.mockResolvedValue({ balanceDays: 15 });

      const mockQb = {
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ total: 0 }),
      };
      requestRepo.createQueryBuilder.mockReturnValue(mockQb);

      const result = await service.getAvailableBalance('emp_1', 'loc_1', 'PTO');
      expect(result).toBe(15);
    });
  });

  describe('getPendingDays', () => {
    it('should sum pending request days', async () => {
      const mockQb = {
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ total: 5 }),
      };
      requestRepo.createQueryBuilder.mockReturnValue(mockQb);

      const result = await service.getPendingDays('emp_1', 'loc_1', 'PTO');
      expect(result).toBe(5);
    });

    it('should return 0 when no pending requests', async () => {
      const mockQb = {
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ total: 0 }),
      };
      requestRepo.createQueryBuilder.mockReturnValue(mockQb);

      const result = await service.getPendingDays('emp_1', 'loc_1', 'PTO');
      expect(result).toBe(0);
    });

    it('should handle null result gracefully', async () => {
      const mockQb = {
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue(null),
      };
      requestRepo.createQueryBuilder.mockReturnValue(mockQb);

      const result = await service.getPendingDays('emp_1', 'loc_1', 'PTO');
      expect(result).toBe(0);
    });
  });

  describe('upsertBalance', () => {
    it('should create new balance when none exists', async () => {
      balanceRepo.findOne.mockResolvedValue(null);
      balanceRepo.create.mockReturnValue({
        employeeId: 'emp_1',
        locationId: 'loc_1',
        leaveType: 'PTO',
        balanceDays: 10,
      });
      balanceRepo.save.mockResolvedValue({
        id: 'uuid-1',
        employeeId: 'emp_1',
        locationId: 'loc_1',
        leaveType: 'PTO',
        balanceDays: 10,
      });

      await service.upsertBalance('emp_1', 'loc_1', 'PTO', 10, ChangeSource.HCM_BATCH);

      expect(balanceRepo.create).toHaveBeenCalled();
      expect(balanceRepo.save).toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          previousBalance: 0,
          newBalance: 10,
          changeSource: ChangeSource.HCM_BATCH,
        }),
      );
    });

    it('should update existing balance', async () => {
      const existing = {
        id: 'uuid-1',
        employeeId: 'emp_1',
        locationId: 'loc_1',
        leaveType: 'PTO',
        balanceDays: 5,
      };
      balanceRepo.findOne.mockResolvedValue(existing);
      balanceRepo.save.mockResolvedValue({ ...existing, balanceDays: 10 });

      await service.upsertBalance('emp_1', 'loc_1', 'PTO', 10, ChangeSource.HCM_REALTIME);

      expect(balanceRepo.save).toHaveBeenCalled();
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          previousBalance: 5,
          newBalance: 10,
          changeSource: ChangeSource.HCM_REALTIME,
        }),
      );
    });
  });

  describe('deductBalance', () => {
    it('should deduct days and log audit', async () => {
      const balance = { balanceDays: 10, employeeId: 'emp_1', locationId: 'loc_1', leaveType: 'PTO' };
      balanceRepo.findOne.mockResolvedValue(balance);
      balanceRepo.save.mockResolvedValue({ ...balance, balanceDays: 7 });

      await service.deductBalance('emp_1', 'loc_1', 'PTO', 3, 'req_1');

      expect(balance.balanceDays).toBe(7);
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          previousBalance: 10,
          newBalance: 7,
          changeSource: ChangeSource.REQUEST_APPROVED,
          referenceId: 'req_1',
        }),
      );
    });

    it('should throw when balance not found', async () => {
      balanceRepo.findOne.mockResolvedValue(null);

      await expect(
        service.deductBalance('emp_1', 'loc_1', 'PTO', 3, 'req_1'),
      ).rejects.toThrow('Balance not found');
    });
  });

  describe('restoreBalanceLocally', () => {
    it('should add days back and log audit', async () => {
      const balance = { balanceDays: 7, employeeId: 'emp_1', locationId: 'loc_1', leaveType: 'PTO' };
      balanceRepo.findOne.mockResolvedValue(balance);
      balanceRepo.save.mockResolvedValue({ ...balance, balanceDays: 10 });

      await service.restoreBalanceLocally('emp_1', 'loc_1', 'PTO', 3, 'req_1');

      expect(balance.balanceDays).toBe(10);
      expect(auditService.log).toHaveBeenCalledWith(
        expect.objectContaining({
          previousBalance: 7,
          newBalance: 10,
          changeSource: ChangeSource.REQUEST_CANCELLED,
        }),
      );
    });

    it('should throw when balance not found', async () => {
      balanceRepo.findOne.mockResolvedValue(null);

      await expect(
        service.restoreBalanceLocally('emp_1', 'loc_1', 'PTO', 3, 'req_1'),
      ).rejects.toThrow('Balance not found');
    });
  });

  describe('getBalances', () => {
    it('should return enriched balances with available days and stale flag', async () => {
      balanceRepo.find.mockResolvedValue([
        {
          employeeId: 'emp_1',
          locationId: 'loc_1',
          leaveType: 'PTO',
          balanceDays: 10,
          lastSyncedAt: new Date(), // fresh
        },
      ]);

      const mockQb = {
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ total: 3 }),
      };
      requestRepo.createQueryBuilder.mockReturnValue(mockQb);

      const result = await service.getBalances('emp_1');

      expect(result.employeeId).toBe('emp_1');
      expect(result.balances).toHaveLength(1);
      expect(result.balances[0].totalDays).toBe(10);
      expect(result.balances[0].availableDays).toBe(7);
      expect(result.balances[0].pendingDays).toBe(3);
      expect(result.balances[0].stale).toBe(false);
    });

    it('should mark stale balances', async () => {
      const staleDate = new Date(Date.now() - 600000); // 10 min ago
      balanceRepo.find.mockResolvedValue([
        {
          employeeId: 'emp_1',
          locationId: 'loc_1',
          leaveType: 'PTO',
          balanceDays: 10,
          lastSyncedAt: staleDate,
        },
      ]);

      hcmService.verifyBalance.mockRejectedValue(new Error('HCM down'));

      const mockQb = {
        select: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getRawOne: jest.fn().mockResolvedValue({ total: 0 }),
      };
      requestRepo.createQueryBuilder.mockReturnValue(mockQb);

      const result = await service.getBalances('emp_1');

      expect(result.balances[0].stale).toBe(true);
    });
  });
});
