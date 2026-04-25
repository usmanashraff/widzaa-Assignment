import {
  Injectable,
  Inject,
  Logger,
  ConflictException,
  NotFoundException,
  BadRequestException,
  BadGatewayException,
  GatewayTimeoutException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Not, In, DataSource, LessThanOrEqual, MoreThanOrEqual } from 'typeorm';
import { TimeOffRequest } from './entities/time-off-request.entity';
import { BalanceService } from '../balance/balance.service';
import { type IHcmService, HCM_SERVICE } from '../hcm/hcm.interface';
import { RequestStatus } from '../common/enums';
import { CreateRequestDto, RejectRequestDto, ListRequestsQueryDto } from './dto';

@Injectable()
export class RequestService {
  private readonly logger = new Logger(RequestService.name);

  constructor(
    @InjectRepository(TimeOffRequest)
    private requestRepo: Repository<TimeOffRequest>,
    private balanceService: BalanceService,
    @Inject(HCM_SERVICE)
    private hcmService: IHcmService,
    private dataSource: DataSource,
  ) {}

  async createRequest(dto: CreateRequestDto): Promise<any> {
    // Validate dates
    if (dto.endDate < dto.startDate) {
      throw new BadRequestException({
        code: 'INVALID_DATES',
        message: 'End date must be after or equal to start date.',
      });
    }

    const daysRequested = dto.daysRequested || this.calculateDays(dto.startDate, dto.endDate);

    if (daysRequested <= 0) {
      throw new BadRequestException({
        code: 'INVALID_DAYS',
        message: 'Days requested must be greater than 0.',
      });
    }

    // Check for overlapping requests
    const overlap = await this.findOverlappingRequest(
      dto.employeeId,
      dto.locationId,
      dto.leaveType,
      dto.startDate,
      dto.endDate,
    );

    if (overlap) {
      throw new ConflictException({
        code: 'OVERLAPPING_REQUEST',
        message: 'An existing request already covers some of these dates.',
      });
    }

    // Layer 1: Local available balance check
    const availableBalance = await this.balanceService.getAvailableBalance(
      dto.employeeId,
      dto.locationId,
      dto.leaveType,
    );

    if (availableBalance < daysRequested) {
      throw new ConflictException({
        code: 'INSUFFICIENT_BALANCE',
        message: `Available balance is ${availableBalance} days but ${daysRequested} days were requested.`,
        availableBalance,
      });
    }

    // Try to verify with HCM (non-blocking — if HCM is down, we still accept)
    try {
      const hcmBalance = await this.hcmService.verifyBalance(
        dto.employeeId,
        dto.locationId,
        dto.leaveType,
      );

      if (hcmBalance.balanceDays < daysRequested) {
        throw new ConflictException({
          code: 'INSUFFICIENT_BALANCE',
          message: `HCM reports balance of ${hcmBalance.balanceDays} days, but ${daysRequested} days were requested.`,
          availableBalance: hcmBalance.balanceDays,
        });
      }
    } catch (error) {
      if (error instanceof ConflictException) {
        throw error;
      }
      // HCM unreachable — accept locally, verification deferred to approval
      this.logger.warn(`HCM verification skipped: ${error.message}`);
    }

    // Create the request
    const request = this.requestRepo.create({
      employeeId: dto.employeeId,
      locationId: dto.locationId,
      leaveType: dto.leaveType,
      startDate: dto.startDate,
      endDate: dto.endDate,
      daysRequested,
      status: RequestStatus.PENDING,
    });

    const saved = await this.requestRepo.save(request);

    // Recalculate remaining available balance after this request is now pending
    const remainingBalance = availableBalance - daysRequested;

    return {
      requestId: saved.id,
      status: saved.status,
      daysRequested: Number(saved.daysRequested),
      remainingBalance,
    };
  }

  async approveRequest(requestId: string): Promise<any> {
    const request = await this.requestRepo.findOne({ where: { id: requestId } });

    if (!request) {
      throw new NotFoundException({
        code: 'REQUEST_NOT_FOUND',
        message: 'Request not found.',
      });
    }

    if (
      request.status !== RequestStatus.PENDING &&
      request.status !== RequestStatus.PENDING_REVIEW
    ) {
      throw new ConflictException({
        code: 'INVALID_STATUS_TRANSITION',
        message: `Cannot approve a request with status ${request.status}.`,
      });
    }

    // Re-check available balance (balance may have changed since submission)
    const availableBalance = await this.balanceService.getAvailableBalance(
      request.employeeId,
      request.locationId,
      request.leaveType,
    );

    // Available balance already excludes this request's pending days,
    // so we need to add them back for the check
    const pendingDays = await this.balanceService.getPendingDays(
      request.employeeId,
      request.locationId,
      request.leaveType,
    );

    const totalBalance = availableBalance + pendingDays;
    const otherPendingDays = pendingDays - Number(request.daysRequested);
    const effectiveAvailable = totalBalance - otherPendingDays;

    if (effectiveAvailable < Number(request.daysRequested)) {
      throw new ConflictException({
        code: 'INSUFFICIENT_BALANCE',
        message: `Balance has changed since submission. Available: ${effectiveAvailable} days, requested: ${request.daysRequested} days.`,
      });
    }

    // Call HCM to file the deduction with idempotency key
    try {
      const hcmResult = await this.hcmService.fileDeduction(
        request.employeeId,
        request.locationId,
        request.leaveType,
        Number(request.daysRequested),
        request.id, // idempotency key = request ID
      );

      if (!hcmResult.success) {
        // HCM rejected
        request.status = RequestStatus.REJECTED;
        request.rejectionReason = hcmResult.error || 'HCM rejected the deduction';
        await this.requestRepo.save(request);

        throw new BadGatewayException({
          code: 'HCM_ERROR',
          message: `HCM rejected the deduction: ${hcmResult.error}`,
        });
      }

      // HCM confirmed — approve and deduct locally
      request.status = RequestStatus.APPROVED;
      request.hcmReferenceId = hcmResult.referenceId || '';
      await this.requestRepo.save(request);

      // Deduct from local balance
      await this.balanceService.deductBalance(
        request.employeeId,
        request.locationId,
        request.leaveType,
        Number(request.daysRequested),
        request.id,
      );

      return {
        requestId: request.id,
        status: request.status,
        hcmReferenceId: request.hcmReferenceId,
      };
    } catch (error) {
      if (
        error instanceof BadGatewayException ||
        error instanceof ConflictException
      ) {
        throw error;
      }

      if (error.message === 'HCM_TIMEOUT') {
        // HCM timeout — mark for review
        request.status = RequestStatus.PENDING_REVIEW;
        request.rejectionReason = 'HCM did not respond in time. Marked for review.';
        await this.requestRepo.save(request);

        throw new GatewayTimeoutException({
          code: 'HCM_TIMEOUT',
          message: 'HCM did not respond in time. Request has been marked for review.',
        });
      }

      throw error;
    }
  }

  async rejectRequest(requestId: string, dto: RejectRequestDto): Promise<any> {
    const request = await this.requestRepo.findOne({ where: { id: requestId } });

    if (!request) {
      throw new NotFoundException({
        code: 'REQUEST_NOT_FOUND',
        message: 'Request not found.',
      });
    }

    if (
      request.status !== RequestStatus.PENDING &&
      request.status !== RequestStatus.PENDING_REVIEW
    ) {
      throw new ConflictException({
        code: 'INVALID_STATUS_TRANSITION',
        message: `Cannot reject a request with status ${request.status}.`,
      });
    }

    request.status = RequestStatus.REJECTED;
    request.rejectionReason = dto.reason;
    await this.requestRepo.save(request);

    return {
      requestId: request.id,
      status: request.status,
      rejectionReason: request.rejectionReason,
    };
  }

  async cancelRequest(requestId: string): Promise<any> {
    const request = await this.requestRepo.findOne({ where: { id: requestId } });

    if (!request) {
      throw new NotFoundException({
        code: 'REQUEST_NOT_FOUND',
        message: 'Request not found.',
      });
    }

    if (
      request.status === RequestStatus.REJECTED ||
      request.status === RequestStatus.CANCELLED
    ) {
      throw new ConflictException({
        code: 'INVALID_STATUS_TRANSITION',
        message: `Cannot cancel a request with status ${request.status}.`,
      });
    }

    if (request.status === RequestStatus.APPROVED) {
      // Need to restore balance in HCM
      try {
        const hcmResult = await this.hcmService.restoreBalance(
          request.employeeId,
          request.locationId,
          request.leaveType,
          Number(request.daysRequested),
          `cancel-${request.id}`,
        );

        if (!hcmResult.success) {
          this.logger.error(`HCM restore failed for request ${requestId}: ${hcmResult.error}`);
          // Flag for manual reconciliation but still cancel locally
        }
      } catch (error) {
        this.logger.error(`HCM restore error for request ${requestId}: ${error.message}`);
        // Flag for manual reconciliation but still cancel locally
      }

      // Restore local balance
      await this.balanceService.restoreBalanceLocally(
        request.employeeId,
        request.locationId,
        request.leaveType,
        Number(request.daysRequested),
        request.id,
      );
    }

    // For PENDING/PENDING_REVIEW: just cancel, no HCM call needed, pending days auto-released
    request.status = RequestStatus.CANCELLED;
    await this.requestRepo.save(request);

    return {
      requestId: request.id,
      status: request.status,
    };
  }

  async getRequest(requestId: string): Promise<TimeOffRequest> {
    const request = await this.requestRepo.findOne({ where: { id: requestId } });

    if (!request) {
      throw new NotFoundException({
        code: 'REQUEST_NOT_FOUND',
        message: 'Request not found.',
      });
    }

    return request;
  }

  async listRequests(query: ListRequestsQueryDto): Promise<any> {
    const page = Number(query.page) || 1;
    const limit = Math.min(Number(query.limit) || 20, 100);
    const skip = (page - 1) * limit;

    const where: any = {};
    if (query.status) where.status = query.status;
    if (query.locationId) where.locationId = query.locationId;
    if (query.employeeId) where.employeeId = query.employeeId;
    if (query.leaveType) where.leaveType = query.leaveType;

    const [data, total] = await this.requestRepo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip,
      take: limit,
    });

    return {
      data,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Check PENDING requests that may be invalidated by a balance change.
   * Called after batch/realtime sync.
   */
  async flagInvalidPendingRequests(
    employeeId: string,
    locationId: string,
    leaveType: string,
    manager?: any,
  ): Promise<number> {
    const repo = manager ? manager.getRepository(TimeOffRequest) : this.requestRepo;
    const pendingRequests = await repo.find({
      where: {
        employeeId,
        locationId,
        leaveType,
        status: RequestStatus.PENDING,
      },
      order: { createdAt: 'ASC' },
    });

    if (pendingRequests.length === 0) return 0;

    const availableBalance = await this.balanceService.getAvailableBalance(
      employeeId,
      locationId,
      leaveType,
      manager,
    );

    // Calculate cumulative pending days to find which requests are now invalid
    let cumulativeDays = 0;
    let flaggedCount = 0;

    // We need the total balance (available + all pending) to check each request
    const totalPending = pendingRequests.reduce(
      (sum, r) => sum + Number(r.daysRequested),
      0,
    );
    const totalBalance = availableBalance + totalPending;

    let runningBalance = totalBalance;
    for (const request of pendingRequests) {
      runningBalance -= Number(request.daysRequested);
      if (runningBalance < 0) {
        request.status = RequestStatus.PENDING_REVIEW;
        request.rejectionReason = 'Balance reduced by sync. Please re-review.';
        await repo.save(request);
        flaggedCount++;
      }
    }

    return flaggedCount;
  }

  private calculateDays(startDate: string, endDate: string): number {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const diffMs = end.getTime() - start.getTime();
    return Math.floor(diffMs / (1000 * 60 * 60 * 24)) + 1; // inclusive
  }

  private async findOverlappingRequest(
    employeeId: string,
    locationId: string,
    leaveType: string,
    startDate: string,
    endDate: string,
  ): Promise<TimeOffRequest | null> {
    return this.requestRepo
      .createQueryBuilder('r')
      .where('r.employee_id = :employeeId', { employeeId })
      .andWhere('r.location_id = :locationId', { locationId })
      .andWhere('r.leave_type = :leaveType', { leaveType })
      .andWhere('r.status NOT IN (:...excludedStatuses)', {
        excludedStatuses: [RequestStatus.CANCELLED, RequestStatus.REJECTED],
      })
      .andWhere('r.start_date <= :endDate', { endDate })
      .andWhere('r.end_date >= :startDate', { startDate })
      .getOne();
  }
}
