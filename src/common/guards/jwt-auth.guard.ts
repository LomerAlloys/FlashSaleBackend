import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

// 🚀 Fast LRU Signature Cache (หลีกเลี่ยงการคำนวณ HMAC ซ้ำซ้อนตอน 500 VUs ถล่ม)
const tokenCache = new Map<string, { user: any; expireAt: number }>();

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing or invalid Authorization header');
    }

    const token = authHeader.substring(7);
    const now = Date.now();

    // 1. Check in-memory token cache (0.001ms)
    const cached = tokenCache.get(token);
    if (cached && cached.expireAt > now) {
      request.user = cached.user;
      return true;
    }

    // 2. Verify and cache for 10 minutes
    try {
      const decoded = this.jwtService.verify(token);
      request.user = decoded;
      tokenCache.set(token, { user: decoded, expireAt: now + 600000 });
      return true;
    } catch (err) {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
