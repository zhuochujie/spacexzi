import { BullModule } from '@nestjs/bullmq';
import { requiredEnv, requiredIntEnv } from 'src/common/env.util';
import { NodeAdminModule } from 'src/node/node-admin.module';
import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { AdminAuthModule } from 'src/admin-auth/admin-auth.module';
import { AdminModule } from 'src/admin/admin.module';
import { AdminGuard } from 'src/auth/admin.guard';
import { AuthGuard } from 'src/auth/auth.guard';
import { DatabaseModule } from 'src/infrastructure/database.module';
import { JwtModule } from 'src/infrastructure/jwt.module';
import { AdminActionNotificationInterceptor } from 'src/notification/admin-action-notification.interceptor';
import { TelegramNotificationService } from 'src/notification/telegram-notification.service';

@Module({
  imports: [
    NodeAdminModule,
    BullModule.forRoot({
      connection: {
        host: requiredEnv('REDIS_HOST'),
        port: requiredIntEnv('REDIS_PORT'),
        password: process.env.REDIS_PASSWORD || undefined,
      },
    }),
    DatabaseModule,
    JwtModule,
    AdminAuthModule,
    AdminModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: AuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: AdminGuard,
    },
    TelegramNotificationService,
    {
      provide: APP_INTERCEPTOR,
      useClass: AdminActionNotificationInterceptor,
    },
  ],
})
export class AdminApiModule {}
