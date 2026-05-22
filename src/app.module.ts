import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AppController } from './app.controller';
import { AuthModule } from './auth/auth.module';
import { PrismaModule } from './prisma/prisma.module';
import { TenantsModule } from './tenants/tenants.module';
import { HealthModule } from './health/health.module';
import { TransportModule } from './transport/transport.module';
import { DriversModule } from './drivers/drivers.module';
import { AdminModule } from './admin/admin.module';
import { DriverModule } from './driver/driver.module';
import { InventoryModule } from './inventory/inventory.module';
import { CustomersModule } from './customers/customers.module';
import { DashboardModule } from "./dashboard/dashboard.module";
import { FinanceModule } from './finance/finance.module';
import { AuditModule } from './audit/audit.module';
import { OpsModule } from './ops/ops.module';
import { VehiclesModule } from './vehicles/vehicles.module';
import { MasterModule } from './master/master.module';
import { FleetVehiclesModule } from "./fleet-vehicles/fleet-vehicles.module";
import { PlacesModule } from './places/places.module';
import { UsersModule } from "./users/users.module";
import { RealtimeModule } from "./realtime/realtime.module";
import { NotificationsModule } from "./notifications/notifications.module";
import { PushModule } from "./push/push.module";

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
  ],
  controllers: [AppController],
})
export class AppModule { }
