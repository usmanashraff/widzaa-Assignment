import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  IHcmService,
  HcmBalanceResponse,
  HcmDeductionResponse,
  HcmRestoreResponse,
} from './hcm.interface';

@Injectable()
export class HcmService implements IHcmService {
  private readonly logger = new Logger(HcmService.name);
  private readonly baseUrl: string;
  private readonly timeout: number;

  constructor(private configService: ConfigService) {
    this.baseUrl = this.configService.get<string>('HCM_BASE_URL', 'http://localhost:3001');
    this.timeout = this.configService.get<number>('HCM_TIMEOUT_MS', 5000);
  }

  async verifyBalance(
    employeeId: string,
    locationId: string,
    leaveType: string,
  ): Promise<HcmBalanceResponse> {
    const url = `${this.baseUrl}/api/hcm/balance/${employeeId}/${locationId}/${leaveType}`;
    this.logger.log(`Verifying balance: ${url}`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, { signal: controller.signal });

      if (!response.ok) {
        throw new Error(`HCM returned ${response.status}: ${await response.text()}`);
      }

      return await response.json();
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error('HCM_TIMEOUT');
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async fileDeduction(
    employeeId: string,
    locationId: string,
    leaveType: string,
    days: number,
    idempotencyKey: string,
  ): Promise<HcmDeductionResponse> {
    const url = `${this.baseUrl}/api/hcm/deduct`;
    this.logger.log(`Filing deduction: ${employeeId}/${locationId}/${leaveType} - ${days} days`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({ employeeId, locationId, leaveType, days }),
        signal: controller.signal,
      });

      const data = await response.json();

      if (!response.ok) {
        return { success: false, error: data.message || 'HCM rejected the deduction' };
      }

      return { success: true, referenceId: data.referenceId };
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error('HCM_TIMEOUT');
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async restoreBalance(
    employeeId: string,
    locationId: string,
    leaveType: string,
    days: number,
    idempotencyKey: string,
  ): Promise<HcmRestoreResponse> {
    const url = `${this.baseUrl}/api/hcm/restore`;
    this.logger.log(`Restoring balance: ${employeeId}/${locationId}/${leaveType} + ${days} days`);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify({ employeeId, locationId, leaveType, days }),
        signal: controller.signal,
      });

      const data = await response.json();

      if (!response.ok) {
        return { success: false, error: data.message || 'HCM rejected the restore' };
      }

      return { success: true, referenceId: data.referenceId };
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error('HCM_TIMEOUT');
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
