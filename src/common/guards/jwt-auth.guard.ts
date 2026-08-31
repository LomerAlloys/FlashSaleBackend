import { Injectable, CanActivate, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

// 🚀 Fast LRU Signature Cache (หลีกเลี่ยงการคำนวณ HMAC ซ้ำซ้อนตอน 500 VUs ถล่ม)
// ⚠️ cache เฉพาะ "ผลลัพธ์หลัง verify ผ่านแล้วเท่านั้น" — ห้าม decode payload ตรงๆ โดยไม่ verify
// signature เด็ดขาด (เคยมีคน merge เข้ามาแบบนั้น = ปลอม JWT อ้างเป็น user ไหนก็ได้โดยไม่ต้องรู้
// secret เลย เป็นช่องโหว่ auth เต็มรูปแบบ)
//
// ขอบเขตขนาด: จำกัดไว้ที่ MAX_TOKEN_CACHE_SIZE เพื่อไม่ให้ Map โตไม่มีที่สิ้นสุดถ้า
// token หมุนเวียนไม่ซ้ำกันจำนวนมาก (Map รักษาลำดับ insertion อยู่แล้ว ใช้เป็น
// approximate-LRU ได้: ตอน hit ย้าย entry ไปท้ายสุด ตอนเกินโควต้าตัด entry แรกสุดทิ้ง)
const MAX_TOKEN_CACHE_SIZE = 10000;
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
      // ย้ายไปท้ายสุดของ Map (most-recently-used) เพื่อให้ eviction ด้านล่างตัด
      // entry ที่ไม่ได้ใช้นานที่สุดออกก่อนจริงๆ
      tokenCache.delete(token);
      tokenCache.set(token, cached);
      request.user = cached.user;
      return true;
    }

    // 2. Verify signature จริง (jwtService.verify ตรวจ HMAC ด้วย secret) แล้ว cache ผล 10 นาที
    try {
      const decoded = this.jwtService.verify(token);
      request.user = decoded;
      tokenCache.set(token, { user: decoded, expireAt: now + 600000 });
      if (tokenCache.size > MAX_TOKEN_CACHE_SIZE) {
        const oldestKey = tokenCache.keys().next().value;
        if (oldestKey !== undefined) tokenCache.delete(oldestKey);
      }
      return true;
    } catch (err) {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
