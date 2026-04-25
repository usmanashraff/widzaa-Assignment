import { Controller, Post, Get, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';
import { SyncService } from './sync.service';
import { BatchSyncDto, RealtimeSyncDto } from './dto';

@ApiTags('Sync')
@Controller('v1/sync')
export class SyncController {
  constructor(private readonly syncService: SyncService) {}

  @Post('batch')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Receive batch balance sync from HCM' })
  async batchSync(@Body() dto: BatchSyncDto) {
    return this.syncService.batchSync(dto);
  }

  @Post('realtime')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Receive realtime balance update from HCM' })
  async realtimeSync(@Body() dto: RealtimeSyncDto) {
    return this.syncService.realtimeSync(dto);
  }

  @Get('status')
  @ApiOperation({ summary: 'Get sync status' })
  async getSyncStatus() {
    return this.syncService.getSyncStatus();
  }
}
