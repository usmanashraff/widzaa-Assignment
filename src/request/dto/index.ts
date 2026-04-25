import { IsString, IsDateString, IsNotEmpty, IsOptional, IsNumber, Min } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateRequestDto {
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

  @ApiProperty({ example: '2026-05-01' })
  @IsDateString()
  startDate: string;

  @ApiProperty({ example: '2026-05-03' })
  @IsDateString()
  endDate: string;

  @ApiPropertyOptional({ example: 3, description: 'Override computed days (for half-day support)' })
  @IsOptional()
  @IsNumber()
  @Min(0.5)
  daysRequested?: number;
}

export class RejectRequestDto {
  @ApiProperty({ example: 'Team already short-staffed on those dates.' })
  @IsString()
  @IsNotEmpty()
  reason: string;
}

export class ListRequestsQueryDto {
  @ApiPropertyOptional({ example: 'PENDING' })
  @IsOptional()
  @IsString()
  status?: string;

  @ApiPropertyOptional({ example: 'loc_nyc' })
  @IsOptional()
  @IsString()
  locationId?: string;

  @ApiPropertyOptional({ example: 'emp_123' })
  @IsOptional()
  @IsString()
  employeeId?: string;

  @ApiPropertyOptional({ example: 'PTO' })
  @IsOptional()
  @IsString()
  leaveType?: string;

  @ApiPropertyOptional({ example: 1, default: 1 })
  @IsOptional()
  page?: number;

  @ApiPropertyOptional({ example: 20, default: 20 })
  @IsOptional()
  limit?: number;
}
