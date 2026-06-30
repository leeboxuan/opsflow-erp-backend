import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';
import { TenantsModule } from './tenants/tenants.module';
import { HealthModule } from './shared/health/health.module';
import { TransportModule } from './transport/transport.module';
import { DriversModule } from './drivers/drivers.module';
import { AdminModule } from './admin/admin.module';
import { DriverModule } from './driver/driver.module';
import { InventoryModule } from './warehousing/inventory/inventory.module';
import { CustomersModule } from './transport/customers/customers.module';
import { DashboardModule } from "./dashboard/dashboard.module";
import { FinanceModule } from './finance/finance.module';
import { AuditModule } from './shared/audit/audit.module';
import { OpsModule } from './ops/ops.module';
import { VehiclesModule } from './transport/vehicles/vehicles.module';
import { MasterModule } from './transport/master-rates/master.module';
import { FleetVehiclesModule } from "./transport/fleet/vehicles/fleet-vehicles.module";
import { PlacesModule } from './shared/places/places.module';
import { UsersModule } from "./shared/users/users.module";
import { RealtimeModule } from "./realtime/realtime.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { PushModule } from "./push/push.module";
import { DeviceGatewayModule } from "./transport/fleet/device-gateway/device-gateway.module";
import { FleetTrackingModule } from "./transport/fleet/tracking/fleet-tracking.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    PrismaModule,
    AuthModule,
    TenantsModule,
    HealthModule,
    TransportModule,
    DriversModule,
    AdminModule,
    DriverModule,
    InventoryModule,
    CustomersModule,
    DashboardModule,
    FinanceModule,
    AuditModule,
    OpsModule,
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
  ],
  controllers: [AppController],
})
export class AppModule { }
