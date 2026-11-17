import { Injectable, Logger, Module } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Cron } from '@nestjs/schedule';
import { Job } from 'bullmq';
import { NodeCoreModule } from './node-core.module';
import { NodeService } from './node.service';
@Processor('node-queue')
export class NodeProcessor extends WorkerHost {
  constructor(private readonly service: NodeService) {
    super();
  }
  process(job: Job<string>) {
    return this.service.processNonce(job.data);
  }
}
@Injectable()
export class NodeScheduler {
  private readonly logger = new Logger(NodeScheduler.name);
  private running = false;
  constructor(private readonly service: NodeService) {}
  @Cron('*/5 * * * *', { timeZone: 'Asia/Shanghai' })
  async reconcile() {
    if (this.running) return;
    this.running = true;
    try {
      await this.service.reconcile();
    } catch (error) {
      this.logger.error('Node nonce reconciliation failed', error);
    } finally {
      this.running = false;
    }
  }
}
@Module({
  imports: [NodeCoreModule],
  providers: [NodeProcessor, NodeScheduler],
})
export class NodeWorkerModule {}
