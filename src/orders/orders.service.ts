import { Injectable, BadRequestException, ConflictException, NotFoundException, Inject, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import Redis from 'ioredis';
import { ProductsService } from '../products/products.service';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @InjectQueue('order-queue') private readonly ordersQueue: Queue,
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
    private readonly productsService: ProductsService,
  ) {}

  async createOrder(userId: string, productId: string) {
    if (!productId) {
      throw new BadRequestException('productId is required');
    }

    // 1. Limit 1 per User: ใช้อัลกอริทึม Atomic SETNX ของ Redis ล็อกสิทธิ์ทันที
    const userOrderLockKey = `lock:order:${userId}:${productId}`;
    const acquired = await this.redis.set(userOrderLockKey, '1', 'EX', 120, 'NX');

    if (!acquired) {
      throw new ConflictException('You have already submitted an order for this product.');
    }

    // 2. เช็คว่ามีสินค้านี้จริงไหม (อ่านจาก Redis exists-cache อย่างรวดเร็ว)
    const productExists = await this.productsService.exists(productId);
    if (!productExists) {
      await this.redis.del(userOrderLockKey);
      throw new NotFoundException(`Product ${productId} not found`);
    }

    // 3. เพิ่ม Job เข้า BullMQ แบบ Asynchronous (เก็บประวัติ 500 jobs ล่าสุดสำหรับ Bull-Board)
    try {
      const job = await this.ordersQueue.add(
        'process-order',
        { userId, productId },
        {
          jobId: `${userId}_${productId}`,
          attempts: 3,
          backoff: { type: 'exponential', delay: 200 },
          removeOnComplete: 500, // 👈 เก็บประวัติ Completed Jobs ล่าสุด 500 รายการ
          removeOnFail: 500,     // 👈 เก็บประวัติ Failed (Out of stock) ล่าสุด 500 รายการ
        },
      );

      return {
        status: 'processing',
        orderJobId: `job-${job.id}`,
        message: 'Your order is in the queue.',
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (message.toLowerCase().includes('already exists')) {
        throw new ConflictException('You have already submitted an order for this product.');
      }
      await this.redis.del(userOrderLockKey);
      throw err;
    }
  }
}
