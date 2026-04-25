import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiParam, ApiQuery } from '@nestjs/swagger';
import { RequestService } from './request.service';
import { CreateRequestDto, RejectRequestDto, ListRequestsQueryDto } from './dto';

@ApiTags('Requests')
@Controller('v1/requests')
export class RequestController {
  constructor(private readonly requestService: RequestService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Submit a time-off request' })
  async createRequest(@Body() dto: CreateRequestDto) {
    return this.requestService.createRequest(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List requests with filters and pagination' })
  async listRequests(@Query() query: ListRequestsQueryDto) {
    return this.requestService.listRequests(query);
  }

  @Get(':requestId')
  @ApiOperation({ summary: 'Get a specific request' })
  @ApiParam({ name: 'requestId', example: 'req_abc' })
  async getRequest(@Param('requestId') requestId: string) {
    return this.requestService.getRequest(requestId);
  }

  @Patch(':requestId/approve')
  @ApiOperation({ summary: 'Approve a request (manager)' })
  @ApiParam({ name: 'requestId', example: 'req_abc' })
  async approveRequest(@Param('requestId') requestId: string) {
    return this.requestService.approveRequest(requestId);
  }

  @Patch(':requestId/reject')
  @ApiOperation({ summary: 'Reject a request (manager)' })
  @ApiParam({ name: 'requestId', example: 'req_abc' })
  async rejectRequest(
    @Param('requestId') requestId: string,
    @Body() dto: RejectRequestDto,
  ) {
    return this.requestService.rejectRequest(requestId, dto);
  }

  @Delete(':requestId')
  @ApiOperation({ summary: 'Cancel a request (employee)' })
  @ApiParam({ name: 'requestId', example: 'req_abc' })
  async cancelRequest(@Param('requestId') requestId: string) {
    return this.requestService.cancelRequest(requestId);
  }
}
