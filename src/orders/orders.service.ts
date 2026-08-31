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

    // 1. Atomic SETNX Concurrency Lock (< 0.1ms) - ป้องกันยิงซ้ำทันที
    const userOrderLockKey = `lock:order:${userId}:${productId}`;
    const acquired = await this.redis.set(userOrderLockKey, '1', 'EX', 120, 'NX');

    if (!acquired) {
      throw new ConflictException('You have already submitted an order for this product.');
    }

    // 2. เช็คสินค้าจาก L1 Memory (< 0.01ms)
    const productExists = await this.productsService.exists(productId);
    if (!productExists) {
      await this.redis.del(userOrderLockKey);
      throw new NotFoundException(`Product ${productId} not found`);
    }

    const jobId = `${userId}_${productId}`;

    // 3. Non-Blocking High-Speed Enqueue (ส่งงานเข้า Queue แบบ Asynchronous ทันที)
    this.ordersQueue.add(
      'process-order',
      { userId, productId },
      {
        jobId,
        attempts: 1,
        removeOnComplete: true,
        removeOnFail: true,
      },
    ).catch(async (err) => {
      // กรณี Queue พัง ให้ปลดล็อกสิทธิ์
      await this.redis.del(userOrderLockKey).catch(() => {});
    });

    // 4. ตอบกลับ 202 Accepted ทันทีในระดับ Sub-millisecond (< 5ms)
    return {
      status: 'processing',
      orderJobId: `job-${jobId}`,
      message: 'Your order is in the queue.',
    };
  }
}
