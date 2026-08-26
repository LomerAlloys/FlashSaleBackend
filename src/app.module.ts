import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CacheModule } from '@nestjs/cache-manager';
import { redisStore } from 'cache-manager-redis-yet';
import { BullModule } from '@nestjs/bull';
import { Redis } from 'ioredis';
import { LoggerModule } from 'nestjs-pino';
import { randomUUID } from 'crypto';

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { Product } from './products/entities/product.entity';
import { Order } from './orders/entities/order.entity';

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
        genReqId: (req) => req.headers['x-correlation-id'] || randomUUID(),
        customProps: () => ({
          instanceId: process.env.INSTANCE_ID || 'Unknown Instance',
        }),
      },
    }),

    // 🗄️ PostgreSQL Database Connection (ใช้ชื่อ flash_sale_db)
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST || process.env.DB_MASTER_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      username: String(process.env.DB_USER || 'myuser'),
      password: String(process.env.DB_PASSWORD || 'mypassword'),
      database: String(process.env.DB_NAME || 'flash_sale_db'),
      entities: [Product, Order],
      synchronize: true, // 🔄 ล้างและสร้าง Schema ใหม่ให้อัตโนมัติตาม Entity
      extra: {
        max: 15,
      },
    }),
    
    // 🔴 Redis CacheModule
    CacheModule.registerAsync({
      isGlobal: true,
      useFactory: async () => ({
        store: await redisStore({
          socket: {
            host: process.env.REDIS_HOST || 'localhost',
            port: parseInt(process.env.REDIS_PORT || '6379', 10),
          },
          ttl: (parseInt(process.env.REDIS_TTL || '300', 10)) * 1000,
        }),
      }),
    }),

    // 📨 BullMQ Configuration
    BullModule.forRoot({
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
      },
    }),
    
    AuthModule,
    ProductsModule,
    OrdersModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: 'REDIS_CLIENT',
      useFactory: () => {
        return new Redis({
          host: process.env.REDIS_HOST || 'localhost',
          port: parseInt(process.env.REDIS_PORT || '6379', 10),
        });
      },
    },
  ],
  exports: ['REDIS_CLIENT', BullModule], 
})
export class AppModule {}