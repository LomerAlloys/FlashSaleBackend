import { Provider } from '@nestjs/common';
import { Redis } from 'ioredis';

export const REDIS_CLIENT = 'REDIS_CLIENT';

export const redisClientProvider: Provider = {
  provide: REDIS_CLIENT,
  useFactory: () =>
    new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379', 10),
      // รวมหลาย command ที่ยิงพร้อมกันในรอบ event loop เดียวกันเป็น 1 network round-trip
      enableAutoPipelining: true,
    }),
};
