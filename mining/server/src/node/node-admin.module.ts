import { Module } from '@nestjs/common';
import { NodeCoreModule } from './node-core.module';
import { NodeAdminController } from './node-admin.controller';
@Module({ imports: [NodeCoreModule], controllers: [NodeAdminController] })
export class NodeAdminModule {}
