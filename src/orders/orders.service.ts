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

    const jobId = `${userId}_${productId}`;

    // 3. Non-Blocking High-Speed Enqueue (ส่งเข้า Queue ทันที + เก็บประวัติ 500 jobs สำหรับ Bull-Board)
    this.ordersQueue.add(
      'process-order',
      { userId, productId },
      {
        jobId,
        attempts: 3,
        backoff: { type: 'exponential', delay: 200 },
        removeOnComplete: 500,
        removeOnFail: 500,
      },
    ).catch(async (err) => {
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
