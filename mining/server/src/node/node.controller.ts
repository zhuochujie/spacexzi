import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  CurrentAccount,
  type JwtAccount,
} from 'src/common/decorators/current-account.decorator';
import { MaintenanceBlocked } from 'src/maintenance/maintenance-blocked.decorator';
import { AdminPageQueryDto } from 'src/admin/dto/admin-page-query.dto';
import { NodeService } from './node.service';
import { NodeNonceDto, NodePurchaseDto } from './node.dto';
@Controller('node')
export class NodeController {
  constructor(private readonly service: NodeService) {}
  @Get('referral-stats') referralStats(@CurrentAccount() a: JwtAccount) {
    return this.service.referralStats(a.sub);
  }
  @Get('pending-purchase') pendingPurchase(@CurrentAccount() a: JwtAccount) {
    return this.service.pendingPurchase(a.sub);
  }
  @Post('purchase')
  @MaintenanceBlocked()
  purchase(@CurrentAccount() a: JwtAccount, @Body() dto: NodePurchaseDto) {
    return this.service.purchase(a.sub, dto.targetLevelIndex);
  }
  @Post('nonce') submit(
    @CurrentAccount() a: JwtAccount,
    @Body() dto: NodeNonceDto,
  ) {
    return this.service.submitNonce(a.sub, dto.nonce);
  }
  @Get('nonce/:nonce') status(
    @CurrentAccount() a: JwtAccount,
    @Param() dto: NodeNonceDto,
  ) {
    return this.service.nonceStatus(a.sub, dto.nonce);
  }
  @Get('rewards') rewards(
    @CurrentAccount() a: JwtAccount,
    @Query() q: AdminPageQueryDto,
  ) {
    return this.service.list('rewards', q.page, q.pageSize, a.sub);
  }
}
