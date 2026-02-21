import { Module } from '@nestjs/common';
import { DriverController } from './driver.controller';
import { LocationService } from './location.service';
import { DriverMvpService } from './driver-mvp.service';
import { GoogleMapsService } from '../common/google-maps.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';
import { TransportModule } from '../transport/transport.module';

@Module({
  imports: [PrismaModule, AuthModule, TransportModule],
  controllers: [DriverController],
  providers: [GoogleMapsService, LocationService, DriverMvpService],
  exports: [LocationService],
})
export class DriverModule {}
