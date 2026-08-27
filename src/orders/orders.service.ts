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

    // เช็คว่ามี productId นี้จริงไหม (อ่านอย่างเดียว ไม่ผิดกฎ "ห้ามเขียน DB" ของ controller)
    const productExists = await this.productsService.exists(productId);
    if (!productExists) {
      throw new NotFoundException(`Product ${productId} not found`);
    }

    // 🔒 Concurrency Handling (API Level - Slide 3 in Spec PDF)
    // 1. Limit 1 per User: ใช้อัลกอริทึม Atomic SETNX ของ Redis ล็อกสิทธิ์ไม่ให้ผู้ใช้ส่ง Request เบิ้ล/สั่งซื้อซ้ำ
    const userOrderLockKey = `lock:order:${userId}:${productId}`;
    const acquired = await this.redis.set(userOrderLockKey, '1', 'EX', 60, 'NX');

    if (!acquired) {
      this.logger.warn(`🚫 Concurrency Blocked: User ${userId} already submitted order for ${productId}`);
      throw new ConflictException('You have already submitted an order for this product.');
    }

    // 📨 2. เพิ่ม Job เข้า Message Queue (BullMQ) แบบ Asynchronous (Slide 2.3)
    const job = await this.ordersQueue.add(
      'process-order',
      { userId, productId },
      {
        // BullMQ ห้ามใส่ ":" ใน custom jobId (Redis จองไว้เป็น separator ภายในของคิวเอง)
        // ใช้ "_" แทนตามที่ตกลงกับทีม (CONTRACT.md เขียนไว้เป็น ":" แต่ทำจริงไม่ได้)
        jobId: `${userId}_${productId}`,
        attempts: 3,
        backoff: { type: 'exponential', delay: 200 },
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
