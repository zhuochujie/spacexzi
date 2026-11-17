import { Module } from '@nestjs/common';
import { ConfigService } from './config.service';
import { Config } from './entities/config.entity';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DividendRule } from './entities/dividend-rule.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Config, DividendRule])],
  providers: [ConfigService],
  exports: [ConfigService],
})
export class ConfigModule {}
