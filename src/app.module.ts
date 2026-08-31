import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CacheModule } from '@nestjs/cache-manager';
import { redisStore } from 'cache-manager-redis-yet';
import { BullModule } from '@nestjs/bullmq';
import { LoggerModule } from 'nestjs-pino';

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

    // 📌 Structured Log (Pino) - ตั้งค่า level: warn และ autoLogging: false เพื่อความเร็วสูงสุด
    LoggerModule.forRoot({
      pinoHttp: {
        level: 'warn',
        autoLogging: false,
      },
    }),

    // 🗄️ PostgreSQL Database Connection
    TypeOrmModule.forRoot({
      type: 'postgres',
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      username: String(process.env.DB_USER || 'myuser'),
      password: String(process.env.DB_PASSWORD || 'mypassword'),
      database: String(process.env.DB_NAME || 'flash_sale_db'),
      entities: [Product, Order],
      synchronize: false,
      extra: {
        max: 25,
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
