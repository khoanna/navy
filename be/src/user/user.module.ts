import { Module } from '@nestjs/common';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { PrivyService } from '../wallet/privy.service';
import { NavyConfigService } from '../config/config.service';

@Module({
  controllers: [UserController],
  providers: [UserService, PrivyService, NavyConfigService],
})
export class UserModule {}
