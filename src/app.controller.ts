import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { AppService } from './app.service';
import { DataSource } from 'typeorm';
import { Redis } from 'ioredis';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    // 📌 Inject สิ่งที่ต้องใช้ตรวจสอบ (DB และ Redis)
    private readonly dataSource: DataSource,
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  // API ไว้เช็คว่า Load Balancer กระจายมาถูกไหม
  @Get('status')
  getStatus() {
    return {
      status: 'OK',
      instanceId: process.env.INSTANCE_ID || 'Unknown Instance',
    };
  }

  // 📌 API Health Check แบบตรวจสถานะของจริง (Part 4)
  @Get('health')
  async checkHealth() {
    try {
      // 1. ลองยิงคำสั่งเบาๆ ไปที่ Database
      await this.dataSource.query('SELECT 1');
      
      // 2. ลองยิง Ping ไปที่ Redis
      await this.redis.ping();
      
      return {
        status: 'Healthy',
        instanceId: process.env.INSTANCE_ID,
        db: 'Connected',
        redis: 'Connected'
      };
    } catch (error) {
      // ถ้าตัวใดตัวหนึ่งพัง ให้ตอบ 503 Service Unavailable ทันที
      throw new ServiceUnavailableException({
        status: 'Unhealthy',
        instanceId: process.env.INSTANCE_ID,
        message: 'Dependencies are down'
      });
    }
  }
}