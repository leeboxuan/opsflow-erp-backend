import { Module } from '@nestjs/common';
import { TransportController } from './transport.controller';
import { TransportService } from './transport.service';
import { TripController } from './trip.controller';
import { TripService } from './trip.service';
import { PodController } from './pod.controller';
import { PodService } from './pod.service';
import { StopService } from './stop.service';
import { EventLogService } from './event-log.service';
import { PrismaModule } from '../prisma/prisma.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [TransportController, TripController, PodController],
  providers: [
    TransportService,
    TripService,
    PodService,
    StopService,
    EventLogService,
  ],
  exports: [TripService, EventLogService],
})
export class TransportModule {}
