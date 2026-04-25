export interface HcmBalanceResponse {
  employeeId: string;
  locationId: string;
  leaveType: string;
  balanceDays: number;
}

export interface HcmDeductionResponse {
  success: boolean;
  referenceId?: string;
  error?: string;
}

export interface HcmRestoreResponse {
  success: boolean;
  referenceId?: string;
  error?: string;
}

export interface IHcmService {
  verifyBalance(
    employeeId: string,
    locationId: string,
    leaveType: string,
  ): Promise<HcmBalanceResponse>;

  fileDeduction(
    employeeId: string,
    locationId: string,
    leaveType: string,
    days: number,
    idempotencyKey: string,
  ): Promise<HcmDeductionResponse>;

  restoreBalance(
    employeeId: string,
    locationId: string,
    leaveType: string,
    days: number,
    idempotencyKey: string,
  ): Promise<HcmRestoreResponse>;
}

export const HCM_SERVICE = 'HCM_SERVICE';
