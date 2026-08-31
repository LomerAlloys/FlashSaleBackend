import { Injectable, BadRequestException, ConflictException, NotFoundException, Inject } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import Redis from 'ioredis';
import { ProductsService } from '../products/products.service';

@Injectable()
export class OrdersService {
  constructor(
    @InjectQueue('order-queue') private readonly ordersQueue: Queue,
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
    private readonly productsService: ProductsService,
  ) {}

  async createOrder(userId: string, productId: string) {
    if (!productId) {
      throw new BadRequestException('productId is required');
    }

    // 1. Atomic SETNX Concurrency Lock (< 0.1ms) - TTL 60s ตาม CONTRACT.md
    const userOrderLockKey = `lock:order:${userId}:${productId}`;
    const acquired = await this.redis.set(userOrderLockKey, '1', 'EX', 60, 'NX');

    if (!acquired) {
      throw new ConflictException('You have already submitted an order for this product.');
    }

    // 2. Fast product existence check from L1 RAM
    const productExists = await this.productsService.exists(productId);
    if (!productExists) {
      await this.redis.del(userOrderLockKey);
      throw new NotFoundException(`Product ${productId} not found`);
    }

    // 3. Fast Enqueue into BullMQ — ต้อง await เสมอ ไม่งั้นตอบ 202 ไปแล้วทั้งที่ enqueue อาจ fail จริง
    // (เช่น jobId ซ้ำ ต้องแปลงเป็น 409 ตาม contract — non-blocking แบบไม่ await ทำแบบนั้นไม่ได้
    // เพราะ response ถูกส่งไปก่อนที่จะรู้ผลด้วยซ้ำ)
    try {
      const job = await this.ordersQueue.add(
        'process-order',
        { userId, productId },
        {
          jobId: `${userId}_${productId}`,
          attempts: 3,
          backoff: { type: 'exponential', delay: 200 },
          removeOnComplete: 500,
          removeOnFail: 500,
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
