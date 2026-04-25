import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as supertest from 'supertest';
const request = supertest.default || supertest;
import { TypeOrmModule } from '@nestjs/typeorm';
import { ConfigModule } from '@nestjs/config';
import { BalanceModule } from '../src/balance/balance.module';
import { RequestModule } from '../src/request/request.module';
import { SyncModule } from '../src/sync/sync.module';
import { AuditModule } from '../src/audit/audit.module';
import { HcmModule } from '../src/hcm/hcm.module';
import { HCM_SERVICE } from '../src/hcm/hcm.interface';
import { LeaveBalance } from '../src/balance/entities/leave-balance.entity';
import { TimeOffRequest } from '../src/request/entities/time-off-request.entity';
import { BalanceAuditLog } from '../src/audit/entities/balance-audit-log.entity';

/**
 * E2E Test Suite for the Time-Off Microservice
 * 
 * These tests use a real in-memory SQLite database and a mocked HCM service.
 * They test the full HTTP request/response lifecycle through all layers.
 */
describe('Time-Off Microservice (e2e)', () => {
  let app: INestApplication;
  let mockHcm: any;

  const createMockHcm = () => ({
    verifyBalance: jest.fn().mockResolvedValue({ employeeId: 'emp_1', locationId: 'loc_1', leaveType: 'PTO', balanceDays: 20 }),
    fileDeduction: jest.fn().mockResolvedValue({ success: true, referenceId: 'hcm_ref_123' }),
    restoreBalance: jest.fn().mockResolvedValue({ success: true, referenceId: 'hcm_restore_123' }),
  });

  beforeAll(async () => {
    mockHcm = createMockHcm();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true }),
        TypeOrmModule.forRoot({
          type: 'better-sqlite3',
          database: ':memory:',
          entities: [LeaveBalance, TimeOffRequest, BalanceAuditLog],
          synchronize: true,
        }),
        BalanceModule,
        RequestModule,
        SyncModule,
        AuditModule,
        HcmModule,
      ],
    })
      .overrideProvider(HCM_SERVICE)
      .useValue(mockHcm)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  // =========================================
  // SYNC ENDPOINTS — seed data first
  // =========================================
  describe('Sync Endpoints', () => {
    describe('POST /v1/sync/batch', () => {
      it('should accept batch sync and create balances', async () => {
        const res = await request(app.getHttpServer())
          .post('/v1/sync/batch')
          .send({
            balances: [
              { employeeId: 'emp_1', locationId: 'loc_nyc', leaveType: 'PTO', balanceDays: 15 },
              { employeeId: 'emp_1', locationId: 'loc_nyc', leaveType: 'SICK', balanceDays: 5 },
              { employeeId: 'emp_1', locationId: 'loc_dubai', leaveType: 'PTO', balanceDays: 12 },
              { employeeId: 'emp_2', locationId: 'loc_nyc', leaveType: 'PTO', balanceDays: 8 },
            ],
          })
          .expect(200);

        expect(res.body.processed).toBe(4);
        expect(res.body.created).toBeGreaterThanOrEqual(0);
      });

      it('should handle empty batch', async () => {
        const res = await request(app.getHttpServer())
          .post('/v1/sync/batch')
          .send({ balances: [] })
          .expect(200);

        expect(res.body.processed).toBe(0);
      });

      it('should reject invalid batch payload', async () => {
        await request(app.getHttpServer())
          .post('/v1/sync/batch')
          .send({ balances: [{ employeeId: 'emp_1' }] }) // missing fields
          .expect(400);
      });
    });

    describe('POST /v1/sync/realtime', () => {
      it('should update a single balance', async () => {
        const res = await request(app.getHttpServer())
          .post('/v1/sync/realtime')
          .send({
            employeeId: 'emp_1',
            locationId: 'loc_nyc',
            leaveType: 'PTO',
            balanceDays: 18,
            reason: 'WORK_ANNIVERSARY',
          })
          .expect(200);

        expect(res.body.newBalance).toBe(18);
        expect(res.body.changeSource).toBe('HCM_REALTIME');
      });
    });

    describe('GET /v1/sync/status', () => {
      it('should return sync status', async () => {
        const res = await request(app.getHttpServer())
          .get('/v1/sync/status')
          .expect(200);

        expect(res.body).toHaveProperty('lastBatchSyncAt');
        expect(res.body).toHaveProperty('lastRealtimeSyncAt');
      });
    });
  });

  // =========================================
  // BALANCE ENDPOINTS
  // =========================================
  describe('Balance Endpoints', () => {
    describe('GET /v1/balances/:employeeId', () => {
      it('should return all balances for an employee', async () => {
        const res = await request(app.getHttpServer())
          .get('/v1/balances/emp_1')
          .expect(200);

        expect(res.body.employeeId).toBe('emp_1');
        expect(res.body.balances.length).toBeGreaterThanOrEqual(2);

        const ptoBalance = res.body.balances.find(
          (b: any) => b.leaveType === 'PTO' && b.locationId === 'loc_nyc',
        );
        expect(ptoBalance).toBeDefined();
        expect(ptoBalance.totalDays).toBe(18); // updated by realtime sync
      });

      it('should return empty balances for unknown employee', async () => {
        const res = await request(app.getHttpServer())
          .get('/v1/balances/emp_unknown')
          .expect(200);

        expect(res.body.balances).toHaveLength(0);
      });
    });

    describe('GET /v1/balances/:employeeId/:locationId', () => {
      it('should return balances for a specific location', async () => {
        const res = await request(app.getHttpServer())
          .get('/v1/balances/emp_1/loc_nyc')
          .expect(200);

        expect(res.body.balances.length).toBeGreaterThanOrEqual(1);
      });

      it('should return 404 for unknown location', async () => {
        await request(app.getHttpServer())
          .get('/v1/balances/emp_1/loc_unknown')
          .expect(404);
      });
    });
  });

  // =========================================
  // REQUEST LIFECYCLE
  // =========================================
  describe('Request Lifecycle', () => {
    let requestId: string;

    describe('POST /v1/requests — Submit', () => {
      it('should create a time-off request', async () => {
        const res = await request(app.getHttpServer())
          .post('/v1/requests')
          .send({
            employeeId: 'emp_1',
            locationId: 'loc_nyc',
            leaveType: 'PTO',
            startDate: '2026-06-01',
            endDate: '2026-06-03',
          })
          .expect(201);

        expect(res.body.requestId).toBeDefined();
        expect(res.body.status).toBe('PENDING');
        expect(res.body.daysRequested).toBe(3);
        requestId = res.body.requestId;
      });

      it('should reject invalid date range', async () => {
        await request(app.getHttpServer())
          .post('/v1/requests')
          .send({
            employeeId: 'emp_1',
            locationId: 'loc_nyc',
            leaveType: 'PTO',
            startDate: '2026-06-05',
            endDate: '2026-06-01',
          })
          .expect(400);
      });

      it('should reject overlapping requests', async () => {
        const res = await request(app.getHttpServer())
          .post('/v1/requests')
          .send({
            employeeId: 'emp_1',
            locationId: 'loc_nyc',
            leaveType: 'PTO',
            startDate: '2026-06-02',
            endDate: '2026-06-04',
          })
          .expect(409);

        expect(res.body.code).toBe('OVERLAPPING_REQUEST');
      });

      it('should reject when balance is insufficient', async () => {
        const res = await request(app.getHttpServer())
          .post('/v1/requests')
          .send({
            employeeId: 'emp_2',
            locationId: 'loc_nyc',
            leaveType: 'PTO',
            startDate: '2026-06-01',
            endDate: '2026-06-20', // 20 days, but only 8 available
          })
          .expect(409);

        expect(res.body.code).toBe('INSUFFICIENT_BALANCE');
      });

      it('should reject missing required fields', async () => {
        await request(app.getHttpServer())
          .post('/v1/requests')
          .send({ employeeId: 'emp_1' })
          .expect(400);
      });
    });

    describe('GET /v1/requests/:requestId — View', () => {
      it('should return request details', async () => {
        const res = await request(app.getHttpServer())
          .get(`/v1/requests/${requestId}`)
          .expect(200);

        expect(res.body.id).toBe(requestId);
        expect(res.body.status).toBe('PENDING');
        expect(res.body.employeeId).toBe('emp_1');
      });

      it('should return 404 for unknown request', async () => {
        await request(app.getHttpServer())
          .get('/v1/requests/00000000-0000-0000-0000-000000000000')
          .expect(404);
      });
    });

    describe('GET /v1/requests — List with filters', () => {
      it('should list pending requests', async () => {
        const res = await request(app.getHttpServer())
          .get('/v1/requests?status=PENDING')
          .expect(200);

        expect(res.body.data.length).toBeGreaterThanOrEqual(1);
        expect(res.body.pagination).toBeDefined();
        expect(res.body.pagination.page).toBe(1);
      });

      it('should filter by location', async () => {
        const res = await request(app.getHttpServer())
          .get('/v1/requests?locationId=loc_nyc')
          .expect(200);

        res.body.data.forEach((r: any) => {
          expect(r.locationId).toBe('loc_nyc');
        });
      });

      it('should support pagination', async () => {
        const res = await request(app.getHttpServer())
          .get('/v1/requests?page=1&limit=1')
          .expect(200);

        expect(res.body.data.length).toBeLessThanOrEqual(1);
        expect(res.body.pagination.limit).toBe(1);
      });
    });

    describe('PATCH /v1/requests/:requestId/approve — Approve', () => {
      it('should approve a pending request', async () => {
        const res = await request(app.getHttpServer())
          .patch(`/v1/requests/${requestId}/approve`)
          .expect(200);

        expect(res.body.status).toBe('APPROVED');
        expect(res.body.hcmReferenceId).toBe('hcm_ref_123');
      });

      it('should not approve an already approved request', async () => {
        await request(app.getHttpServer())
          .patch(`/v1/requests/${requestId}/approve`)
          .expect(409);
      });
    });

    describe('DELETE /v1/requests/:requestId — Cancel approved', () => {
      it('should cancel an approved request and restore balance', async () => {
        const res = await request(app.getHttpServer())
          .delete(`/v1/requests/${requestId}`)
          .expect(200);

        expect(res.body.status).toBe('CANCELLED');
        expect(mockHcm.restoreBalance).toHaveBeenCalled();
      });

      it('should not cancel an already cancelled request', async () => {
        await request(app.getHttpServer())
          .delete(`/v1/requests/${requestId}`)
          .expect(409);
      });
    });

    describe('PATCH /v1/requests/:requestId/reject — Reject', () => {
      let rejectRequestId: string;

      beforeAll(async () => {
        // Create a fresh request to reject
        const res = await request(app.getHttpServer())
          .post('/v1/requests')
          .send({
            employeeId: 'emp_2',
            locationId: 'loc_nyc',
            leaveType: 'PTO',
            startDate: '2026-07-01',
            endDate: '2026-07-02',
          });
        rejectRequestId = res.body.requestId;
      });

      it('should reject a pending request with reason', async () => {
        const res = await request(app.getHttpServer())
          .patch(`/v1/requests/${rejectRequestId}/reject`)
          .send({ reason: 'Team is short-staffed' })
          .expect(200);

        expect(res.body.status).toBe('REJECTED');
        expect(res.body.rejectionReason).toBe('Team is short-staffed');
      });

      it('should not reject an already rejected request', async () => {
        await request(app.getHttpServer())
          .patch(`/v1/requests/${rejectRequestId}/reject`)
          .send({ reason: 'Again' })
          .expect(409);
      });
    });
  });

  // =========================================
  // HCM FAILURE SCENARIOS
  // =========================================
  describe('HCM Failure Scenarios', () => {
    it('should accept request even when HCM is down during submission', async () => {
      mockHcm.verifyBalance.mockRejectedValueOnce(new Error('Connection refused'));

      const res = await request(app.getHttpServer())
        .post('/v1/requests')
        .send({
          employeeId: 'emp_1',
          locationId: 'loc_dubai',
          leaveType: 'PTO',
          startDate: '2026-08-01',
          endDate: '2026-08-02',
        })
        .expect(201);

      expect(res.body.status).toBe('PENDING');
    });

    it('should mark request as PENDING_REVIEW on HCM timeout during approval', async () => {
      // Create a request
      const createRes = await request(app.getHttpServer())
        .post('/v1/requests')
        .send({
          employeeId: 'emp_1',
          locationId: 'loc_nyc',
          leaveType: 'SICK',
          startDate: '2026-09-01',
          endDate: '2026-09-01',
        });

      const reqId = createRes.body.requestId;

      // Make HCM timeout on approval
      mockHcm.fileDeduction.mockRejectedValueOnce(new Error('HCM_TIMEOUT'));

      await request(app.getHttpServer())
        .patch(`/v1/requests/${reqId}/approve`)
        .expect(504);

      // Verify the request is now PENDING_REVIEW
      const getRes = await request(app.getHttpServer())
        .get(`/v1/requests/${reqId}`)
        .expect(200);

      expect(getRes.body.status).toBe('PENDING_REVIEW');
    });

    it('should reject request when HCM rejects the deduction', async () => {
      const createRes = await request(app.getHttpServer())
        .post('/v1/requests')
        .send({
          employeeId: 'emp_2',
          locationId: 'loc_nyc',
          leaveType: 'PTO',
          startDate: '2026-10-01',
          endDate: '2026-10-01',
        });

      const reqId = createRes.body.requestId;

      mockHcm.fileDeduction.mockResolvedValueOnce({
        success: false,
        error: 'Invalid employee-location combination',
      });

      await request(app.getHttpServer())
        .patch(`/v1/requests/${reqId}/approve`)
        .expect(502);

      const getRes = await request(app.getHttpServer())
        .get(`/v1/requests/${reqId}`)
        .expect(200);

      expect(getRes.body.status).toBe('REJECTED');
    });
  });

  // =========================================
  // BATCH SYNC INVALIDATION
  // =========================================
  describe('Batch Sync Invalidation', () => {
    it('should flag pending requests when batch reduces balance', async () => {
      // Create a request for emp_2
      const createRes = await request(app.getHttpServer())
        .post('/v1/requests')
        .send({
          employeeId: 'emp_2',
          locationId: 'loc_nyc',
          leaveType: 'PTO',
          startDate: '2026-11-01',
          endDate: '2026-11-05', // 5 days
        });

      expect(createRes.status).toBe(201);

      // Now batch sync reduces emp_2's balance to 2 (less than 5 pending)
      const syncRes = await request(app.getHttpServer())
        .post('/v1/sync/batch')
        .send({
          balances: [
            { employeeId: 'emp_2', locationId: 'loc_nyc', leaveType: 'PTO', balanceDays: 2 },
          ],
        })
        .expect(200);

      expect(syncRes.body.flaggedRequests).toBeGreaterThanOrEqual(1);
    });
  });

  // =========================================
  // AVAILABLE BALANCE ACCOUNTING
  // =========================================
  describe('Available Balance Accounting', () => {
    it('should account for pending requests in available balance', async () => {
      // Reset emp_1 loc_dubai PTO balance to 10
      await request(app.getHttpServer())
        .post('/v1/sync/realtime')
        .send({
          employeeId: 'emp_1',
          locationId: 'loc_dubai',
          leaveType: 'PTO',
          balanceDays: 10,
        });

      // Create a request for 4 days
      await request(app.getHttpServer())
        .post('/v1/requests')
        .send({
          employeeId: 'emp_1',
          locationId: 'loc_dubai',
          leaveType: 'PTO',
          startDate: '2026-12-01',
          endDate: '2026-12-04',
        })
        .expect(201);

      // Check balance — should show pending days deducted from available
      const balRes = await request(app.getHttpServer())
        .get('/v1/balances/emp_1/loc_dubai')
        .expect(200);

      const ptoBalance = balRes.body.balances.find((b: any) => b.leaveType === 'PTO');
      expect(ptoBalance.totalDays).toBe(10);
      expect(ptoBalance.pendingDays).toBeGreaterThanOrEqual(4);
      expect(ptoBalance.availableDays).toBeLessThanOrEqual(6);
    });
  });
});
