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

    // 1. Atomic SETNX Concurrency Lock (< 0.2ms)
    // EX 60 ตาม CONTRACT.md — ห้ามแก้ค่านี้โดยไม่บอกทีม (ไฟล์นี้โดนแก้เป็น 120 มาแล้ว 2 รอบ)
    const userOrderLockKey = `lock:order:${userId}:${productId}`;
    const acquired = await this.redis.set(userOrderLockKey, '1', 'EX', 60, 'NX');

    if (!acquired) {
      throw new ConflictException('You have already submitted an order for this product.');
    }

    // 2. Fast product existence check from L1 memory
    const productExists = await this.productsService.exists(productId);
    if (!productExists) {
      await this.redis.del(userOrderLockKey);
      throw new NotFoundException(`Product ${productId} not found`);
    }

    // 3. Lightning Fast Enqueue (Lean Job Options for sub-millisecond Lua execution)
    try {
      const job = await this.ordersQueue.add(
        'process-order',
        { userId, productId },
        {
          jobId: `${userId}_${productId}`,
          // attempts:1 ตัดความทนทานทิ้งฟรีๆ โดยไม่ได้ช่วย latency เลย (retry เป็นเรื่องของ worker
          // ไม่กระทบเวลาตอบ 202 นี้) UnrecoverableError (ของหมด/ซื้อซ้ำ) ไม่ retry อยู่แล้ว เก็บ
          // attempts:3 ไว้เผื่อ error ชั่วคราวจริงๆ (DB/connection blip) เท่านั้น
          attempts: 3,
          backoff: { type: 'exponential', delay: 200 },
          // removeOnComplete/Fail:50 จะลบ job เก่าทิ้งกลางอากาศตอนมี failed (ของหมด) เกิน 50
          // ตัวเดียวในเทสเดียว (500 คนแย่ง 50 ชิ้น = fail ~450 ตัว) ทำให้ Bull-Board โชว์ประวัติไม่ครบ
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
