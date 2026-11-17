import {
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { Admin } from 'src/common/decorators/admin.decorator';
import { AdminAction } from 'src/notification/admin-action.decorator';
import { AdminPageQueryDto } from 'src/admin/dto/admin-page-query.dto';
import { NodeService } from './node.service';
@Admin()
@Controller('admin/nodes')
export class NodeAdminController {
  constructor(private readonly service: NodeService) {}
  @Get('purchases') purchases(@Query() q: AdminPageQueryDto) {
    return this.service.list('purchases', q.page, q.pageSize);
  }
  @Get('rewards') rewards(@Query() q: AdminPageQueryDto) {
    return this.service.list('rewards', q.page, q.pageSize);
  }
  @Post('signatures/:id/retry')
  @AdminAction('核对节点购买签名')
  retry(@Param('id', ParseIntPipe) id: number) {
    return this.service.retry(id);
  }
}
