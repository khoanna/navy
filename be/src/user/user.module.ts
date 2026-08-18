import { Module } from '@nestjs/common';
import { UserController } from './user.controller';
import { UserAccountController } from './user-account.controller';
import { UserService } from './user.service';
import { PrivyService } from '../auth/privy.service';

@Module({
  controllers: [UserController, UserAccountController],
  providers: [UserService, PrivyService],
  exports: [UserService],
})
export class UserModule {}
