import { Injectable, BadRequestException, ConflictException, Inject, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bull';
import type { Queue } from 'bull';
import Redis from 'ioredis';

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    @InjectQueue('orders') private readonly ordersQueue: Queue,
    @Inject('REDIS_CLIENT') private readonly redis: Redis,
  ) {}

  async createOrder(userId: string, productId: string) {
    if (!productId) {
      throw new BadRequestException('productId is required');
    }

    // 🔒 Concurrency Handling (API Level - Slide 3 in Spec PDF)
    // 1. Limit 1 per User: ใช้อัลกอริทึม Atomic SETNX ของ Redis ล็อกสิทธิ์ไม่ให้ผู้ใช้ส่ง Request เบิ้ล/สั่งซื้อซ้ำ
    const userOrderLockKey = `user:order:${userId}:${productId}`;
    const acquired = await this.redis.set(userOrderLockKey, '1', 'EX', 86400, 'NX');

    if (!acquired) {
      this.logger.warn(`🚫 Concurrency Blocked: User ${userId} already submitted order for ${productId}`);
      throw new ConflictException('You have already submitted an order for this product.');
    }

    // 📨 2. เพิ่ม Job เข้า Message Queue (BullMQ) แบบ Asynchronous (Slide 2.3)
    const job = await this.ordersQueue.add(
      'process-order',
      { userId, productId },
      {
        attempts: 3,
        backoff: { type: 'exponential', delay: 1000 },
        removeOnComplete: false,
        removeOnFail: false,
      },
    );

    this.logger.log(`📥 [Order Enqueued] Job ID: ${job.id} for user ${userId} buying ${productId}`);

    // 3. ตอบกลับ Client ทันทีแบบ 202 Accepted (Non-blocking)
    return {
      status: 'processing',
      orderJobId: `job-${job.id}`,
      message: 'Your order is in the queue.',
    };
  }
}
