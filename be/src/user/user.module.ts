import { Module } from '@nestjs/common';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { PrivyService } from '../wallet/privy.service';

@Module({
  controllers: [UserController],
  providers: [UserService, PrivyService],
})
export class UserModule {}
