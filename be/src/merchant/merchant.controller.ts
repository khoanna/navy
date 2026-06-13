import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { MerchantService } from './merchant.service';
import { NavyTokenService } from '../auth/navy-token.service';
import { AuditService } from '../audit/audit.service';
import { JwtGuard } from '../auth/jwt.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

class SignupDto { email!: string; password!: string; businessName!: string; }
class LoginDto { email!: string; password!: string; }
class PayoutDto { address!: string; message!: string; signature!: string; }

@Controller()
export class MerchantController {
  constructor(
    private readonly merchants: MerchantService,
    private readonly tokens: NavyTokenService,
    private readonly audit: AuditService,
  ) {}

  @Post('auth/merchant/signup')
  async signup(@Body() dto: SignupDto) {
    const m = await this.merchants.signup(dto.email, dto.password, dto.businessName);
    await this.audit.record({ actor: `merchant:${m.id}`, action: 'merchant.signup' });
    return this.tokens.issue({ subjectId: m.id, role: 'merchant' });
  }

  @Post('auth/merchant')
  async login(@Body() dto: LoginDto) {
    const m = await this.merchants.login(dto.email, dto.password);
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

  @Post('merchant/payout')
  @UseGuards(JwtGuard, RolesGuard)
  @Roles('merchant')
  async setPayout(@Req() req: any, @Body() dto: PayoutDto) {
    const m = await this.merchants.setPayoutAddress(req.user.sub, dto.address, dto.message, dto.signature);
    await this.audit.record({ actor: `merchant:${req.user.sub}`, action: 'merchant.payout.set', target: dto.address });
    return { payoutAddress: m.payoutAddress };
  }
}
