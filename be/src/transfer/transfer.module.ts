import { Module } from '@nestjs/common';
import { TransferController } from './transfer.controller';
import { TransferService } from './transfer.service';
import { TransferWatcherService } from './transfer-watcher.service';
import { UserModule } from '../user/user.module';

@Module({
  imports: [UserModule],
  controllers: [TransferController],
  providers: [TransferService, TransferWatcherService],
  exports: [TransferService],
})
export class TransferModule {}
