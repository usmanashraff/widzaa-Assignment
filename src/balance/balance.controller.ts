import { Controller, Get, Param, NotFoundException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam } from '@nestjs/swagger';
import { BalanceService } from './balance.service';

@ApiTags('Balances')
@Controller('v1/balances')
export class BalanceController {
  constructor(private readonly balanceService: BalanceService) {}

  @Get(':employeeId')
  @ApiOperation({ summary: 'Get all balances for an employee' })
  @ApiParam({ name: 'employeeId', example: 'emp_123' })
  async getBalances(@Param('employeeId') employeeId: string) {
    return this.balanceService.getBalances(employeeId);
  }

  @Get(':employeeId/:locationId')
  @ApiOperation({ summary: 'Get balances for an employee at a specific location' })
  @ApiParam({ name: 'employeeId', example: 'emp_123' })
  @ApiParam({ name: 'locationId', example: 'loc_nyc' })
  async getBalance(
    @Param('employeeId') employeeId: string,
    @Param('locationId') locationId: string,
  ) {
    const result = await this.balanceService.getBalance(employeeId, locationId);
    if (!result) {
      throw new NotFoundException({
        code: 'BALANCE_NOT_FOUND',
        message: 'No balance found for this employee at this location.',
      });
    }
    return result;
  }
}
