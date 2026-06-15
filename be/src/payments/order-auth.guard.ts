import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { OrderAuthService } from './order-auth.service';

@Injectable()
export class OrderAuthGuard implements CanActivate {
  constructor(private readonly auth: OrderAuthService) {}
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const apiKey = req.headers['x-navy-key'];
    const signature = req.headers['x-navy-signature'];
    const rawBody: string = req.rawBody?.toString('utf8') ?? JSON.stringify(req.body ?? {});
    const { merchantId } = await this.auth.verify(apiKey, rawBody, signature);
    req.merchantId = merchantId;
    return true;
  }
}
