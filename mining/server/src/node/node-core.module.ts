import { ConfigModule } from 'src/config/config.module';
import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { Web3Module } from 'src/web3/web3.module';
import { NodeService } from './node.service';
import { NodeWeb3Service } from './node-web3.service';
@Module({
  imports: [
    Web3Module,
    ConfigModule,
    BullModule.registerQueue({
      name: 'node-queue',
      defaultJobOptions: {
        removeOnComplete: { age: 7200 },
        removeOnFail: { age: 604800 },
      },
    }),
  ],
  providers: [NodeService, NodeWeb3Service],
  exports: [NodeService],
})
export class NodeCoreModule {}
