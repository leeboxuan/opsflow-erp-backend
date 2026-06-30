import { Module } from '@nestjs/common';
import { DriverController } from './driver.controller';
import { DriverMvpService } from './driver-mvp.service';
import { GoogleMapsService } from './google-maps.service';
import { PrismaModule } from '../../shared/prisma/prisma.module';
import { AuthModule } from '../../shared/auth/auth.module';
import { TransportModule } from '../transport.module';
import { DriversModule } from '../drivers/drivers.module';

@Module({
  imports: [PrismaModule, AuthModule, TransportModule, DriversModule],
  controllers: [DriverController],
  providers: [GoogleMapsService, DriverMvpService],
})
export class DriverModule {}
