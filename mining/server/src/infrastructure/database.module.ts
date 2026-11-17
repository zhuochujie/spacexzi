import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import {
  optionalBoolEnv,
  requiredEnv,
  requiredIntEnv,
} from 'src/common/env.util';
import { databaseEntities } from './database-entities';

@Global()
@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: requiredEnv('DB_HOST'),
      port: requiredIntEnv('DB_PORT'),
      username: requiredEnv('DB_USERNAME'),
      password: requiredEnv('DB_PASSWORD'),
      database: requiredEnv('DB_DATABASE'),
      synchronize: optionalBoolEnv('TYPEORM_SYNCHRONIZE', false),
      entities: databaseEntities,
      namingStrategy: new SnakeNamingStrategy(),
    }),
  ],
  exports: [TypeOrmModule],
})
export class DatabaseModule {}
