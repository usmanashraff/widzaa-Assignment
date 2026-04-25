import { Test, TestingModule } from '@nestjs/testing';
import { AuditService } from '../../src/audit/audit.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { BalanceAuditLog } from '../../src/audit/entities/balance-audit-log.entity';
import { ChangeSource } from '../../src/common/enums';

describe('AuditService', () => {
  let service: AuditService;
  let auditRepo: any;

  const mockAuditRepo = {
    create: jest.fn(),
    save: jest.fn(),
    find: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuditService,
        { provide: getRepositoryToken(BalanceAuditLog), useValue: mockAuditRepo },
      ],
    }).compile();

    service = module.get<AuditService>(AuditService);
    auditRepo = mockAuditRepo;

    jest.clearAllMocks();
  });

  describe('log', () => {
    it('should create and save an audit entry', async () => {
      const params = {
        employeeId: 'emp_1',
        locationId: 'loc_1',
        leaveType: 'PTO',
        previousBalance: 10,
        newBalance: 7,
        changeSource: ChangeSource.REQUEST_APPROVED,
        referenceId: 'req_1',
      };

      auditRepo.create.mockReturnValue(params);
      auditRepo.save.mockResolvedValue({ id: 'audit_1', ...params });

      const result = await service.log(params);

      expect(auditRepo.create).toHaveBeenCalledWith(params);
      expect(auditRepo.save).toHaveBeenCalled();
      expect(result.id).toBe('audit_1');
    });
  });

  describe('findByEmployee', () => {
    it('should return audit logs sorted by createdAt DESC', async () => {
      const logs = [
        { id: 'audit_2', createdAt: new Date() },
        { id: 'audit_1', createdAt: new Date(Date.now() - 1000) },
      ];
      auditRepo.find.mockResolvedValue(logs);

      const result = await service.findByEmployee('emp_1');

      expect(auditRepo.find).toHaveBeenCalledWith({
        where: { employeeId: 'emp_1' },
        order: { createdAt: 'DESC' },
      });
      expect(result).toHaveLength(2);
    });
  });

  describe('findByEmployeeAndLocation', () => {
    it('should filter by both employee and location', async () => {
      auditRepo.find.mockResolvedValue([]);

      await service.findByEmployeeAndLocation('emp_1', 'loc_1');

      expect(auditRepo.find).toHaveBeenCalledWith({
        where: { employeeId: 'emp_1', locationId: 'loc_1' },
        order: { createdAt: 'DESC' },
      });
    });
  });
});
