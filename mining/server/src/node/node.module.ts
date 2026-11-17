import { MaintenanceModule } from 'src/maintenance/maintenance.module';
import { Module } from '@nestjs/common';
import { NodeCoreModule } from './node-core.module';
import { NodeController } from './node.controller';
@Module({
  imports: [NodeCoreModule, MaintenanceModule],
  controllers: [NodeController],
})
export class NodeModule {}
