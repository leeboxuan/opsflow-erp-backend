import { Global, Module, forwardRef } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { NotificationsModule } from "../notifications/notifications.module";
import { RealtimeController } from "./realtime.controller";
import { RealtimeEventsService } from "./realtime-events.service";

@Global()
@Module({
  imports: [AuthModule, forwardRef(() => NotificationsModule)],
  controllers: [RealtimeController],
  providers: [RealtimeEventsService],
  exports: [RealtimeEventsService],
})
export class RealtimeModule {}
