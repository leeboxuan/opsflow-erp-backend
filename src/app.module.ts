import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AuthModule } from './shared/auth/auth.module';
import { PrismaModule } from './shared/prisma/prisma.module';
import { IdempotencyModule } from './shared/idempotency/idempotency.module';
import { TenantsModule } from './shared/tenants/tenants.module';
import { HealthModule } from './shared/health/health.module';
import { TransportModule } from './transport/transport.module';
import { DriversModule } from './transport/drivers/drivers.module';
import { AdminModule } from './admin/admin.module';
import { DriverModule } from './transport/legacy-driver/driver.module';
import { InventoryModule } from './warehousing/inventory/inventory.module';
import { WarehouseJobsModule } from './warehousing/warehouse-jobs/warehouse-jobs.module';
import { CustomersModule } from './customers/customers.module';
import { DashboardModule } from "./dashboard/dashboard.module";
import { FinanceModule } from './transport/finance/finance.module';
import { AuditModule } from './shared/audit/audit.module';
import { TransportExecutionModule } from './transport/transport-execution.module';
import { VehiclesModule } from './transport/vehicles/vehicles.module';
import { MasterModule } from './transport/master-rates/master.module';
import { FleetVehiclesModule } from "./transport/fleet/vehicles/fleet-vehicles.module";
import { PlacesModule } from './shared/places/places.module';
import { UsersModule } from "./shared/users/users.module";
import { RealtimeModule } from "./shared/realtime/realtime.module";
import { NotificationsModule } from "./shared/notifications/notifications.module";
import { PushModule } from "./shared/push/push.module";
import { DeviceGatewayModule } from "./transport/fleet/device-gateway/device-gateway.module";
import { FleetTrackingModule } from "./transport/fleet/tracking/fleet-tracking.module";
import { PlatformModule } from "./platform/platform.module";
import { PlatformTenantMutationAuditInterceptor } from "./shared/audit/platform-tenant-mutation-audit.interceptor";
import { RejectUntrustedTenantIdInterceptor } from "./shared/auth/reject-untrusted-tenant-id.interceptor";
import { AccessSurfaceInterceptor } from "./shared/auth/guards/access-surface.guard";
import { StatisticsModule } from "./statistics/statistics.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    PrismaModule,
    IdempotencyModule,
    AuthModule,
    TenantsModule,
    HealthModule,
    TransportModule,
    DriversModule,
    AdminModule,
    DriverModule,
    InventoryModule,
    WarehouseJobsModule,
    CustomersModule,
    DashboardModule,
    FinanceModule,
    AuditModule,
    TransportExecutionModule,
    VehiclesModule,
    FleetVehiclesModule,
    MasterModule,
    PlacesModule,
    UsersModule,
    NotificationsModule,
    PushModule,
    RealtimeModule,
    DeviceGatewayModule,
    FleetTrackingModule,
    PlatformModule,
    StatisticsModule,
  ],
  controllers: [AppController],
  providers: [
    {
      provide: APP_INTERCEPTOR,
      useClass: RejectUntrustedTenantIdInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: AccessSurfaceInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: PlatformTenantMutationAuditInterceptor,
    },
  ],
})
export class AppModule { }
