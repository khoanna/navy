import { Body, Controller, Delete, Get, Put, Query, Req, UseGuards } from '@nestjs/common';
import { UserService } from './user.service';
import { JwtGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Throttle } from '@nestjs/throttler';
import { IsString, IsNotEmpty } from 'class-validator';

class SetUsernameDto {
  @IsString() @IsNotEmpty() username!: string;
}

@Controller('user/account')
@UseGuards(JwtGuard, RolesGuard)
@Roles('user')
export class UserAccountController {
  constructor(private readonly users: UserService) {}

  @Get('me')
  me(@Req() req: any) { return this.users.me(req.user.sub); }

  @Get('username/available')
  @Throttle({ default: { ttl: 60000, limit: 20 } })
  async available(@Req() req: any, @Query('u') u: string) {
    return { available: await this.users.isUsernameAvailable(u ?? '', req.user.sub) };
  }

  @Put('username')
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  async set(@Req() req: any, @Body() dto: SetUsernameDto) {
    const u = await this.users.setUsername(req.user.sub, dto.username);
    return { username: u.username };
  }

  @Delete('username')
  async clear(@Req() req: any) {
    await this.users.clearUsername(req.user.sub);
    return { username: null };
  }
}
