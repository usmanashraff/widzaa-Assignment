import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ConflictException, NotFoundException, BadRequestException, BadGatewayException, GatewayTimeoutException } from '@nestjs/common';
import { RequestService } from '../../src/request/request.service';
import { TimeOffRequest } from '../../src/request/entities/time-off-request.entity';
import { BalanceService } from '../../src/balance/balance.service';
import { HCM_SERVICE } from '../../src/hcm/hcm.interface';
import { RequestStatus } from '../../src/common/enums';

describe('RequestService', () => {
  let service: RequestService;
  let requestRepo: any;
  let balanceService: any;
  let hcmService: any;

  const mockRequestRepo = {
    find: jest.fn(),
    findOne: jest.fn(),
    findAndCount: jest.fn(),
    create: jest.fn(),
    save: jest.fn(),
    createQueryBuilder: jest.fn(),
  };

  const mockBalanceService = {
    getAvailableBalance: jest.fn(),
    getPendingDays: jest.fn(),
    deductBalance: jest.fn(),
    restoreBalanceLocally: jest.fn(),
  };

  const mockHcmService = {
    verifyBalance: jest.fn(),
    fileDeduction: jest.fn(),
    restoreBalance: jest.fn(),
  };

  const mockDataSource = {};

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RequestService,
        { provide: getRepositoryToken(TimeOffRequest), useValue: mockRequestRepo },
        { provide: BalanceService, useValue: mockBalanceService },
        { provide: HCM_SERVICE, useValue: mockHcmService },
        { provide: DataSource, useValue: mockDataSource },
      ],
    }).compile();

    service = module.get<RequestService>(RequestService);
    requestRepo = mockRequestRepo;
    balanceService = mockBalanceService;
    hcmService = mockHcmService;

    jest.clearAllMocks();
  });

  describe('createRequest', () => {
    const validDto = {
      employeeId: 'emp_1',
      locationId: 'loc_1',
      leaveType: 'PTO',
      startDate: '2026-05-01',
      endDate: '2026-05-03',
    };

    it('should reject when end date is before start date', async () => {
      await expect(
        service.createRequest({ ...validDto, endDate: '2026-04-30' }),
      ).rejects.toThrow(BadRequestException);
    });

    it('should reject when available balance is insufficient', async () => {
      const mockQb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      };
      requestRepo.createQueryBuilder.mockReturnValue(mockQb);
      balanceService.getAvailableBalance.mockResolvedValue(2);

      await expect(service.createRequest(validDto)).rejects.toThrow(ConflictException);
    });

    it('should reject when HCM reports insufficient balance', async () => {
      const mockQb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      };
      requestRepo.createQueryBuilder.mockReturnValue(mockQb);
      balanceService.getAvailableBalance.mockResolvedValue(10);
      hcmService.verifyBalance.mockResolvedValue({ balanceDays: 1 });

      await expect(service.createRequest(validDto)).rejects.toThrow(ConflictException);
    });

    it('should accept request when HCM is down (graceful degradation)', async () => {
      const mockQb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      };
      requestRepo.createQueryBuilder.mockReturnValue(mockQb);
      balanceService.getAvailableBalance.mockResolvedValue(10);
      hcmService.verifyBalance.mockRejectedValue(new Error('HCM_TIMEOUT'));
      requestRepo.create.mockReturnValue({ ...validDto, id: 'req_1', status: 'PENDING', daysRequested: 3 });
      requestRepo.save.mockResolvedValue({ ...validDto, id: 'req_1', status: 'PENDING', daysRequested: 3 });

      const result = await service.createRequest(validDto);

      expect(result.requestId).toBe('req_1');
      expect(result.status).toBe('PENDING');
    });

    it('should detect overlapping requests', async () => {
      const mockQb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue({ id: 'existing_req' }),
      };
      requestRepo.createQueryBuilder.mockReturnValue(mockQb);

      await expect(service.createRequest(validDto)).rejects.toThrow(ConflictException);
    });

    it('should create request successfully with valid data', async () => {
      const mockQb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      };
      requestRepo.createQueryBuilder.mockReturnValue(mockQb);
      balanceService.getAvailableBalance.mockResolvedValue(10);
      hcmService.verifyBalance.mockResolvedValue({ balanceDays: 10 });
      requestRepo.create.mockReturnValue({ ...validDto, id: 'req_1', status: 'PENDING', daysRequested: 3 });
      requestRepo.save.mockResolvedValue({ ...validDto, id: 'req_1', status: 'PENDING', daysRequested: 3 });

      const result = await service.createRequest(validDto);

      expect(result.requestId).toBe('req_1');
      expect(result.status).toBe('PENDING');
      expect(result.daysRequested).toBe(3);
      expect(result.remainingBalance).toBe(7);
    });

    it('should calculate days inclusively', async () => {
      const mockQb = {
        where: jest.fn().mockReturnThis(),
        andWhere: jest.fn().mockReturnThis(),
        getOne: jest.fn().mockResolvedValue(null),
      };
      requestRepo.createQueryBuilder.mockReturnValue(mockQb);
      balanceService.getAvailableBalance.mockResolvedValue(10);
      hcmService.verifyBalance.mockResolvedValue({ balanceDays: 10 });
      requestRepo.create.mockImplementation((data) => ({ ...data, id: 'req_1' }));
      requestRepo.save.mockImplementation((data) => Promise.resolve(data));

      // May 1 to May 1 should be 1 day
      const result = await service.createRequest({
        ...validDto,
        startDate: '2026-05-01',
        endDate: '2026-05-01',
      });

      expect(result.daysRequested).toBe(1);
    });
  });

  describe('approveRequest', () => {
    it('should throw NotFoundException when request not found', async () => {
      requestRepo.findOne.mockResolvedValue(null);

      await expect(service.approveRequest('req_999')).rejects.toThrow(NotFoundException);
    });

    it('should reject approval of already approved request', async () => {
      requestRepo.findOne.mockResolvedValue({ id: 'req_1', status: RequestStatus.APPROVED });

      await expect(service.approveRequest('req_1')).rejects.toThrow(ConflictException);
    });

    it('should reject approval of cancelled request', async () => {
      requestRepo.findOne.mockResolvedValue({ id: 'req_1', status: RequestStatus.CANCELLED });

      await expect(service.approveRequest('req_1')).rejects.toThrow(ConflictException);
    });

    it('should approve request when HCM confirms', async () => {
      const request = {
        id: 'req_1',
        employeeId: 'emp_1',
        locationId: 'loc_1',
        leaveType: 'PTO',
        daysRequested: 3,
        status: RequestStatus.PENDING,
      };
      requestRepo.findOne.mockResolvedValue(request);
      balanceService.getAvailableBalance.mockResolvedValue(7);
      balanceService.getPendingDays.mockResolvedValue(3);
      hcmService.fileDeduction.mockResolvedValue({ success: true, referenceId: 'hcm_ref_1' });
      requestRepo.save.mockResolvedValue({ ...request, status: RequestStatus.APPROVED });

      const result = await service.approveRequest('req_1');

      expect(result.status).toBe(RequestStatus.APPROVED);
      expect(result.hcmReferenceId).toBe('hcm_ref_1');
      expect(balanceService.deductBalance).toHaveBeenCalled();
    });

    it('should reject when HCM rejects the deduction', async () => {
      const request = {
        id: 'req_1',
        employeeId: 'emp_1',
        locationId: 'loc_1',
        leaveType: 'PTO',
        daysRequested: 3,
        status: RequestStatus.PENDING,
      };
      requestRepo.findOne.mockResolvedValue(request);
      balanceService.getAvailableBalance.mockResolvedValue(7);
      balanceService.getPendingDays.mockResolvedValue(3);
      hcmService.fileDeduction.mockResolvedValue({ success: false, error: 'Insufficient in HCM' });
      requestRepo.save.mockResolvedValue(request);

      await expect(service.approveRequest('req_1')).rejects.toThrow(BadGatewayException);
      expect(request.status).toBe(RequestStatus.REJECTED);
    });

    it('should mark as PENDING_REVIEW on HCM timeout', async () => {
      const request = {
        id: 'req_1',
        employeeId: 'emp_1',
        locationId: 'loc_1',
        leaveType: 'PTO',
        daysRequested: 3,
        status: RequestStatus.PENDING,
      };
      requestRepo.findOne.mockResolvedValue(request);
      balanceService.getAvailableBalance.mockResolvedValue(7);
      balanceService.getPendingDays.mockResolvedValue(3);
      hcmService.fileDeduction.mockRejectedValue(new Error('HCM_TIMEOUT'));
      requestRepo.save.mockResolvedValue(request);

      await expect(service.approveRequest('req_1')).rejects.toThrow(GatewayTimeoutException);
      expect(request.status).toBe(RequestStatus.PENDING_REVIEW);
    });

    it('should allow approving PENDING_REVIEW requests', async () => {
      const request = {
        id: 'req_1',
        employeeId: 'emp_1',
        locationId: 'loc_1',
        leaveType: 'PTO',
        daysRequested: 3,
        status: RequestStatus.PENDING_REVIEW,
      };
      requestRepo.findOne.mockResolvedValue(request);
      balanceService.getAvailableBalance.mockResolvedValue(7);
      balanceService.getPendingDays.mockResolvedValue(3);
      hcmService.fileDeduction.mockResolvedValue({ success: true, referenceId: 'hcm_ref_2' });
      requestRepo.save.mockResolvedValue({ ...request, status: RequestStatus.APPROVED });

      const result = await service.approveRequest('req_1');

      expect(result.status).toBe(RequestStatus.APPROVED);
    });
  });

  describe('rejectRequest', () => {
    it('should reject a PENDING request with reason', async () => {
      const request = { id: 'req_1', status: RequestStatus.PENDING };
      requestRepo.findOne.mockResolvedValue(request);
      requestRepo.save.mockResolvedValue({ ...request, status: RequestStatus.REJECTED });

      const result = await service.rejectRequest('req_1', { reason: 'Team busy' });

      expect(request.status).toBe(RequestStatus.REJECTED);
      expect(request['rejectionReason']).toBe('Team busy');
    });

    it('should not reject an already approved request', async () => {
      requestRepo.findOne.mockResolvedValue({ id: 'req_1', status: RequestStatus.APPROVED });

      await expect(
        service.rejectRequest('req_1', { reason: 'Too late' }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('cancelRequest', () => {
    it('should cancel a PENDING request without calling HCM', async () => {
      const request = { id: 'req_1', status: RequestStatus.PENDING };
      requestRepo.findOne.mockResolvedValue(request);
      requestRepo.save.mockResolvedValue({ ...request, status: RequestStatus.CANCELLED });

      const result = await service.cancelRequest('req_1');

      expect(request.status).toBe(RequestStatus.CANCELLED);
      expect(hcmService.restoreBalance).not.toHaveBeenCalled();
      expect(balanceService.restoreBalanceLocally).not.toHaveBeenCalled();
    });

    it('should cancel an APPROVED request and restore balance', async () => {
      const request = {
        id: 'req_1',
        employeeId: 'emp_1',
        locationId: 'loc_1',
        leaveType: 'PTO',
        daysRequested: 3,
        status: RequestStatus.APPROVED,
      };
      requestRepo.findOne.mockResolvedValue(request);
      hcmService.restoreBalance.mockResolvedValue({ success: true });
      requestRepo.save.mockResolvedValue({ ...request, status: RequestStatus.CANCELLED });

      await service.cancelRequest('req_1');

      expect(hcmService.restoreBalance).toHaveBeenCalled();
      expect(balanceService.restoreBalanceLocally).toHaveBeenCalled();
      expect(request.status).toBe(RequestStatus.CANCELLED);
    });

    it('should not cancel an already cancelled request', async () => {
      requestRepo.findOne.mockResolvedValue({ id: 'req_1', status: RequestStatus.CANCELLED });

      await expect(service.cancelRequest('req_1')).rejects.toThrow(ConflictException);
    });

    it('should not cancel a rejected request', async () => {
      requestRepo.findOne.mockResolvedValue({ id: 'req_1', status: RequestStatus.REJECTED });

      await expect(service.cancelRequest('req_1')).rejects.toThrow(ConflictException);
    });

    it('should still cancel locally even if HCM restore fails', async () => {
      const request = {
        id: 'req_1',
        employeeId: 'emp_1',
        locationId: 'loc_1',
        leaveType: 'PTO',
        daysRequested: 3,
        status: RequestStatus.APPROVED,
      };
      requestRepo.findOne.mockResolvedValue(request);
      hcmService.restoreBalance.mockRejectedValue(new Error('HCM down'));
      requestRepo.save.mockResolvedValue({ ...request, status: RequestStatus.CANCELLED });

      await service.cancelRequest('req_1');

      expect(request.status).toBe(RequestStatus.CANCELLED);
      expect(balanceService.restoreBalanceLocally).toHaveBeenCalled();
    });
  });

  describe('listRequests', () => {
    it('should return paginated results', async () => {
      mockRequestRepo.findAndCount.mockResolvedValue([[{ id: 'req_1' }], 1]);

      const result = await service.listRequests({ page: 1, limit: 20 });

      expect(result.data).toHaveLength(1);
      expect(result.pagination.page).toBe(1);
      expect(result.pagination.total).toBe(1);
    });

    it('should cap limit at 100', async () => {
      mockRequestRepo.findAndCount.mockResolvedValue([[], 0]);

      await service.listRequests({ page: 1, limit: 500 });

      expect(mockRequestRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ take: 100 }),
      );
    });

    it('should apply filters', async () => {
      mockRequestRepo.findAndCount.mockResolvedValue([[], 0]);

      await service.listRequests({
        status: 'PENDING',
        locationId: 'loc_1',
        employeeId: 'emp_1',
        leaveType: 'PTO',
      });

      expect(mockRequestRepo.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            status: 'PENDING',
            locationId: 'loc_1',
            employeeId: 'emp_1',
            leaveType: 'PTO',
          },
        }),
      );
    });
  });

  describe('flagInvalidPendingRequests', () => {
    it('should flag requests when balance is insufficient', async () => {
      const requests = [
        { id: 'req_1', daysRequested: 5, status: RequestStatus.PENDING, createdAt: new Date() },
        { id: 'req_2', daysRequested: 5, status: RequestStatus.PENDING, createdAt: new Date() },
      ];
      mockRequestRepo.find.mockResolvedValue(requests);
      balanceService.getAvailableBalance.mockResolvedValue(-2); // balance is 8, but available is negative because pending = 10
      mockRequestRepo.save.mockImplementation((r) => Promise.resolve(r));

      const flagged = await service.flagInvalidPendingRequests('emp_1', 'loc_1', 'PTO');

      // With total balance = -2 + 10 = 8, first req takes 5 (remaining 3), second takes 5 (remaining -2)
      expect(flagged).toBe(1); // only the second should be flagged
      expect(requests[1].status).toBe(RequestStatus.PENDING_REVIEW);
    });

    it('should return 0 when no pending requests', async () => {
      mockRequestRepo.find.mockResolvedValue([]);

      const flagged = await service.flagInvalidPendingRequests('emp_1', 'loc_1', 'PTO');

      expect(flagged).toBe(0);
    });
  });
});
