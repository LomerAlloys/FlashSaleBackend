import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

// 🚀 Fast LRU Signature Cache (หลีกเลี่ยงการคำนวณ HMAC ซ้ำซ้อนตอน 500 VUs ถล่ม)
// ⚠️ cache เฉพาะ "ผลลัพธ์หลัง verify ผ่านแล้วเท่านั้น" — ห้าม decode payload ตรงๆ โดยไม่ verify
// signature เด็ดขาด (เคยมีคน merge เข้ามาแบบนั้น = ปลอม JWT อ้างเป็น user ไหนก็ได้โดยไม่ต้องรู้
// secret เลย เป็นช่องโหว่ auth เต็มรูปแบบ)
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

    // 1. Check in-memory token cache (0.001ms) — ใช้ได้เพราะ token นี้เคย verify signature
    // ผ่านมาแล้วจริงๆ ในรอบก่อนหน้า ไม่ใช่แค่ decode เฉยๆ
    const cached = tokenCache.get(token);
    if (cached && cached.expireAt > now) {
      request.user = cached.user;
      return true;
    }

    // 2. Verify signature จริง (jwtService.verify ตรวจ HMAC ด้วย secret) แล้ว cache ผล 10 นาที
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
