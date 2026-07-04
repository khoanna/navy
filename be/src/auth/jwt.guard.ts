import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { NavyTokenService } from './navy-token.service';

@Injectable()
export class JwtGuard implements CanActivate {
  constructor(private readonly tokens: NavyTokenService) {}
  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest();
    const header: string = req.headers['authorization'] ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    try { req.user = await this.tokens.verifyAccessWithSession(token); return true; }
    catch { throw new UnauthorizedException('Invalid Navy token'); }
  }
}
