import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'crypto';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { Product } from './entities/product.entity';
import { Order } from './entities/order.entity';
import { redisClientProvider } from './common/redis/redis.provider';

import { AuthModule } from './auth/auth.module';
import { ProductsModule } from './products/products.module';
import { OrdersModule } from './orders/orders.module';

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    
    // 📌 Structured Log (Pino)
    LoggerModule.forRoot({
      pinoHttp: {
        // production: log แค่ warn/error ขึ้นไป — ตัด log "request completed" ทุก request
        // ทิ้ง (ถูกๆ ตอน dev แต่กิน CPU จริงตอนโหลดสูง เพราะต้อง serialize req/res ทุกครั้ง)
        level: process.env.NODE_ENV === 'production' ? 'warn' : 'info',
        genReqId: (req) => req.headers['x-correlation-id'] || randomUUID(),
        customProps: () => ({
          instanceId: process.env.INSTANCE_ID || 'Unknown Instance',
        }),
        // ตัด header เต็มๆ ออกจาก log ที่ยังเหลือ (error/warn) ให้ serialize เบาลง
        serializers: {
          req: (req) => ({ method: req.method, url: req.url }),
          res: (res) => ({ statusCode: res.statusCode }),
        },
      },
    }),

    // 🗄️ PostgreSQL Database Connection (ใช้ชื่อ flash_sale_db)
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      username: String(process.env.DB_USER || 'myuser'),
      password: String(process.env.DB_PASSWORD || 'mypassword'),
      database: String(process.env.DB_NAME || 'flash_sale_db'),
      entities: [Product, Order],
      synchronize: false, // ❗ schema มาจาก migration เท่านั้น (npm run migration:run)
      extra: {
        max: 15,
      },
    }),
    
    // 📨 BullMQ Configuration
    BullModule.forRoot({
      connection: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
      },
    }),
    
    AuthModule,
    ProductsModule,
    OrdersModule,
  ],
  controllers: [AppController],
  providers: [AppService, redisClientProvider],
  exports: ['REDIS_CLIENT', BullModule],
})
export class AppModule {}