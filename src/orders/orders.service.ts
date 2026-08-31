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

    // 1. Atomic SETNX Concurrency Lock (< 0.1ms)
    const userOrderLockKey = `lock:order:${userId}:${productId}`;
    const acquired = await this.redis.set(userOrderLockKey, '1', 'EX', 120, 'NX');

    if (!acquired) {
      throw new ConflictException('You have already submitted an order for this product.');
    }

    // 2. Ultra-fast product existence check from L1 RAM
    const productExists = await this.productsService.exists(productId);
    if (!productExists) {
      await this.redis.del(userOrderLockKey);
      throw new NotFoundException(`Product ${productId} not found`);
    }

    // 3. Lightning Fast BullMQ Enqueue (Minimal Lua overhead)
    try {
      const job = await this.ordersQueue.add(
        'process-order',
        { userId, productId },
        {
          jobId: `${userId}_${productId}`,
          attempts: 1,
          removeOnComplete: true,
          removeOnFail: 50,
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
