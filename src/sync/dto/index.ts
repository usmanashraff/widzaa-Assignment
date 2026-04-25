import { IsString, IsNotEmpty, IsNumber, IsArray, ValidateNested, IsOptional, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class BatchBalanceItemDto {
  @ApiProperty({ example: 'emp_123' })
  @IsString()
  @IsNotEmpty()
  employeeId: string;

  @ApiProperty({ example: 'loc_nyc' })
  @IsString()
  @IsNotEmpty()
  locationId: string;

  @ApiProperty({ example: 'PTO' })
  @IsString()
  @IsNotEmpty()
  leaveType: string;

  @ApiProperty({ example: 10 })
  @IsNumber()
  @Min(0)
  balanceDays: number;
}

export class BatchSyncDto {
  @ApiProperty({ type: [BatchBalanceItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BatchBalanceItemDto)
  balances: BatchBalanceItemDto[];
}

export class RealtimeSyncDto {
  @ApiProperty({ example: 'emp_123' })
  @IsString()
  @IsNotEmpty()
  employeeId: string;

  @ApiProperty({ example: 'loc_nyc' })
  @IsString()
  @IsNotEmpty()
  locationId: string;

  @ApiProperty({ example: 'PTO' })
  @IsString()
  @IsNotEmpty()
  leaveType: string;

  @ApiProperty({ example: 13 })
  @IsNumber()
  @Min(0)
  balanceDays: number;

  @ApiPropertyOptional({ example: 'WORK_ANNIVERSARY' })
  @IsOptional()
  @IsString()
  reason?: string;
}
