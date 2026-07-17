import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { MerchantService } from './merchant.service';
import { MerchantStatsService } from './merchant-stats.service';
import { NavyTokenService } from '../auth/navy-token.service';
import { AuditService } from '../audit/audit.service';
import { JwtGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { Throttle } from '@nestjs/throttler';
import { IsEmail, IsNotEmpty, IsString, MaxLength, MinLength } from 'class-validator';

class SignupDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(8) @MaxLength(128) password!: string;
  @IsString() @IsNotEmpty() businessName!: string;
}
class LoginDto {
  @IsEmail() email!: string;
  @IsString() @MinLength(8) @MaxLength(128) password!: string;
}
class PayoutDto {
  @IsString() @IsNotEmpty() address!: string;
  @IsString() @IsNotEmpty() message!: string;
  @IsString() @IsNotEmpty() signature!: string;
}

@Controller()
export class MerchantController {
  constructor(
    private readonly merchants: MerchantService,
    private readonly tokens: NavyTokenService,
    private readonly audit: AuditService,
    private readonly stats: MerchantStatsService,
  ) {}

  @Get('merchant/stats')
  @UseGuards(JwtGuard, RolesGuard)
  @Roles('merchant')
  async merchantStats(@Req() req: any) {
    return this.stats.forMerchant(req.user.sub);
  }

  @Post('auth/merchant/signup')
  @Throttle({ default: { ttl: 60000, limit: 5 } })
  async signup(@Body() dto: SignupDto) {
    const m = await this.merchants.signup(dto.email, dto.password, dto.businessName);
    await this.audit.record({ actor: `merchant:${m.id}`, action: 'merchant.signup' });
    return this.tokens.issue({ subjectId: m.id, role: 'merchant' });
  }

  @Post('auth/merchant')
  @Throttle({ default: { ttl: 60000, limit: 10 } })
  async login(@Body() dto: LoginDto) {
    let m;
    try {
      m = await this.merchants.login(dto.email, dto.password);
    } catch (e) {
      // Audit the failure with the email as target — NEVER the password.
      await this.audit.record({ actor: `merchant:${dto.email}`, action: 'auth.merchant.login.failed', target: dto.email });
      throw e;
    }
    await this.audit.record({ actor: `merchant:${m.id}`, action: 'auth.merchant.login' });
    return this.tokens.issue({ subjectId: m.id, role: 'merchant' });
  }

  @Post('merchant/api-keys')
  @UseGuards(JwtGuard, RolesGuard)
  @Roles('merchant')
  async createApiKey(@Req() req: any) {
    const out = await this.merchants.issueApiKey(req.user.sub);
    await this.audit.record({ actor: `merchant:${req.user.sub}`, action: 'merchant.apikey.create' });
    return out;
  }

  @Post('merchant/payout/challenge')
  @UseGuards(JwtGuard, RolesGuard)
  @Roles('merchant')
  async payoutChallenge(@Req() req: any) {
    return this.merchants.issuePayoutChallenge(req.user.sub);
  }

  @Post('merchant/payout')
  @UseGuards(JwtGuard, RolesGuard)
  @Roles('merchant')
  async setPayout(@Req() req: any, @Body() dto: PayoutDto) {
    const m = await this.merchants.setPayoutAddress(req.user.sub, dto.address, dto.message, dto.signature);
    await this.audit.record({ actor: `merchant:${req.user.sub}`, action: 'merchant.payout.set', target: dto.address });
    return { payoutAddress: m.payoutAddress };
  }
}
