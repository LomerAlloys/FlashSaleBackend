import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CacheModule } from '@nestjs/cache-manager';
import { redisStore } from 'cache-manager-redis-yet';
import { BullModule } from '@nestjs/bull';
import { Redis } from 'ioredis';

// 📌 1. Import เครื่องมือทำ Structured Log (Part 6)
import { LoggerModule } from 'nestjs-pino';
import { v4 as uuidv4 } from 'uuid'; 

import { AppController } from './app.controller';
import { AppService } from './app.service';
import { StudentsModule } from './students/students.module';
import { Student } from './students/entities/student.entity';

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    
    // 📌 2. เพิ่ม LoggerModule เพื่อสร้าง JSON Log ที่มี Correlation ID (Part 6)
    LoggerModule.forRoot({
      pinoHttp: {
        // สร้าง Correlation ID ให้ทุก Request
        genReqId: (req) => req.headers['x-correlation-id'] || uuidv4(),
        // แนบ Instance ID ไปกับ Log ทุกบรรทัด
        customProps: (req, res) => ({
          instanceId: process.env.INSTANCE_ID || 'Unknown Instance',
        }),
        // ปรับรูปแบบให้อ่านง่ายตอนรันโหมด Dev (ถ้าอยากได้ JSON ดิบๆ ให้ลบบรรทัดนี้ทิ้ง)
        transport: process.env.NODE_ENV !== 'production' ? { target: 'pino-pretty' } : undefined,
      },
    }),

    // 📌 ตั้งค่า TypeORM Replication (Read-Write Split จาก Part 5)
    TypeOrmModule.forRoot({
      type: 'postgres',
      replication: {
        master: {
          host: process.env.DB_MASTER_HOST || 'localhost',
          port: parseInt(process.env.DB_PORT || '5432', 10),
          username: process.env.DB_USER,
          password: process.env.DB_PASSWORD,
          database: process.env.DB_NAME,
        },
        slaves: [
          {
            host: process.env.DB_REPLICA_HOST || 'localhost',
            port: parseInt(process.env.DB_PORT || '5432', 10),
            username: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
            database: process.env.DB_NAME,
          },
        ],
      },
      entities: [Student],
      synchronize: true, 
    }),
    
    // ตั้งค่า CacheModule
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

    // ตั้งค่า BullModule ให้เชื่อมต่อกับ Redis
    BullModule.forRoot({
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT || '6379', 10),
      },
    }),
    
    // สร้างคิวชื่อ 'email' และตั้งค่า Retry
    BullModule.registerQueue({
      name: 'email',
      defaultJobOptions: {
        attempts: 3, 
        backoff: { type: 'exponential', delay: 1000 }, 
        removeOnComplete: true, 
      },
    }),

    StudentsModule,
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
    {
      provide: 'REDIS_PUBLISHER',
      useFactory: () => new Redis({ 
        host: process.env.REDIS_HOST || 'localhost', 
        port: parseInt(process.env.REDIS_PORT || '6379', 10) 
      }),
    },
    {
      provide: 'REDIS_SUBSCRIBER',
      useFactory: () => new Redis({ 
        host: process.env.REDIS_HOST || 'localhost', 
        port: parseInt(process.env.REDIS_PORT || '6379', 10) 
      }),
    },
  ],
  exports: ['REDIS_CLIENT', 'REDIS_PUBLISHER', 'REDIS_SUBSCRIBER', BullModule], 
})
export class AppModule {}