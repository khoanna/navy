import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsNotEmpty, IsString } from 'class-validator';
import { NavyTokenService } from './navy-token.service';
import { JwtGuard } from './jwt.guard';

class RefreshDto {
  @IsString() @IsNotEmpty() refreshToken!: string;
}

@Controller('auth')
export class AuthController {
  constructor(private readonly tokens: NavyTokenService) {}

  @Post('refresh')
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  async refresh(@Body() dto: RefreshDto) {
    return this.tokens.refresh(dto.refreshToken);
  }

  @Post('logout')
  @UseGuards(JwtGuard)
  async logout(@Req() req: any) {
    await this.tokens.revoke(req.user.sid);
    return { ok: true };
  }
}
