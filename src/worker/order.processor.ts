import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { UnrecoverableError, type Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { DataSource, QueryFailedError } from 'typeorm';
import { Product } from '../entities/product.entity';
import { Order } from '../entities/order.entity';
import { ProductsService } from '../products/products.service';

@Processor('order-queue')
export class OrderProcessor extends WorkerHost {
  private readonly logger = new Logger(OrderProcessor.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly productsService: ProductsService,
  ) {
    super();
  }

  async process(job: Job): Promise<any> {
    const { userId, productId } = job.data;
    this.logger.log(`⚙️ [Processing Order Job ${job.id}] User: ${userId}, Product: ${productId}`);

    const result = await this.dataSource.transaction(async (manager) => {
      // 🔒 Concurrency Handling (Worker/Database Level - Slide 3 in Spec PDF)
      // 1. อ่านข้อมูลสินค้าพร้อมใส่ Pessimistic Write Lock เพื่อป้องกัน Race Condition สต็อกติดลบ
      const product = await manager.findOne(Product, {
        where: { productId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!product) {
        this.logger.error(`❌ Product ${productId} not found!`);
        throw new UnrecoverableError(`PRODUCT_NOT_FOUND: ${productId}`);
      }

      if (!product.isFlashSaleActive) {
        this.logger.warn(`⚠️ Flash sale is not active for product ${productId}`);
        throw new UnrecoverableError(`FLASH_SALE_INACTIVE: ${productId}`);
      }

      if (product.remainingStock <= 0) {
        this.logger.warn(`⚠️ Stock empty for product ${productId}! Remaining: ${product.remainingStock}`);
        throw new UnrecoverableError(`OUT_OF_STOCK: Product ${productId} is sold out!`);
      }

      // 2. ตรวจสอบในตาราง Orders ป้องกันซื้อซ้ำในฝั่ง DB
      const existingOrder = await manager.findOne(Order, {
        where: { userId, productId },
      });

      if (existingOrder) {
        this.logger.warn(`⚠️ Duplicate order detected in DB for user ${userId} on product ${productId}`);
        throw new UnrecoverableError(`DUPLICATE_ORDER: User ${userId} already purchased ${productId}`);
      }

      // 3. ตัดสต็อกสินค้าใน DB (การันตีไม่ติดลบ)
      // 4. บันทึกคำสั่งซื้อ
      product.remainingStock -= 1;
      const order = manager.create(Order, {
        userId,
        productId,
        status: 'completed',
      });
      try {
        await manager.save(product);
        await manager.save(order);
      } catch (err) {
        // UNIQUE(userId, productId) หรือ CHECK(remainingStock >= 0) — retry ไม่ช่วย
        if (err instanceof QueryFailedError) {
          const code = (err as QueryFailedError & { driverError?: { code?: string } }).driverError
            ?.code;
          if (code === '23505' || code === '23514') {
            throw new UnrecoverableError(err.message);
          }
        }
        throw err;
      }

      this.logger.log(`✅ [Order Completed] User ${userId} successfully ordered ${productId}! Stock left: ${product.remainingStock}`);

      return {
        success: true,
        orderId: order.id,
        remainingStock: product.remainingStock,
      };
    });

    // 🧹 Cache Invalidation: ทำหลังจาก transaction commit สำเร็จแล้วเท่านั้น
    await this.productsService.invalidateProductCache();

    return result;
  }

  @OnWorkerEvent('active')
  onActive(job: Job) {
    this.logger.log(`🟡 [Order Job Active] Job ${job.id} started processing.`);
  }

  @OnWorkerEvent('completed')
  onCompleted(job: Job) {
    this.logger.log(`🟢 [Order Job Completed] Job ${job.id} finished successfully!`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error) {
    this.logger.error(`🔴 [Order Job Failed] Job ${job?.id}: ${error.message}`);
  }
}
