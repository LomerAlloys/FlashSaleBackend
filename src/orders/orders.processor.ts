import { Processor, Process, OnQueueActive, OnQueueCompleted, OnQueueFailed } from '@nestjs/bull';
import type { Job } from 'bull';
import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Product } from '../products/entities/product.entity';
import { Order } from './entities/order.entity';
import { ProductsService } from '../products/products.service';

@Processor('orders')
export class OrdersProcessor {
  private readonly logger = new Logger(OrdersProcessor.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly productsService: ProductsService,
  ) {}

  @Process('process-order')
  async handleOrder(job: Job) {
    const { userId, productId } = job.data;
    this.logger.log(`⚙️ [Processing Order Job ${job.id}] User: ${userId}, Product: ${productId}`);

    return await this.dataSource.transaction(async (manager) => {
      // 🔒 Concurrency Handling (Worker/Database Level - Slide 3 in Spec PDF)
      // 1. อ่านข้อมูลสินค้าพร้อมใส่ Pessimistic Write Lock เพื่อป้องกัน Race Condition สต็อกติดลบ
      const product = await manager.findOne(Product, {
        where: { productId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!product) {
        this.logger.error(`❌ Product ${productId} not found!`);
        throw new Error(`PRODUCT_NOT_FOUND: ${productId}`);
      }

      if (!product.isFlashSaleActive) {
        this.logger.warn(`⚠️ Flash sale is not active for product ${productId}`);
        throw new Error(`FLASH_SALE_INACTIVE: ${productId}`);
      }

      if (product.remainingStock <= 0) {
        this.logger.warn(`⚠️ Stock empty for product ${productId}! Remaining: ${product.remainingStock}`);
        throw new Error(`OUT_OF_STOCK: Product ${productId} is sold out!`);
      }

      // 2. ตรวจสอบในตาราง Orders ป้องกันซื้อซ้ำในฝั่ง DB
      const existingOrder = await manager.findOne(Order, {
        where: { userId, productId },
      });

      if (existingOrder) {
        this.logger.warn(`⚠️ Duplicate order detected in DB for user ${userId} on product ${productId}`);
        throw new Error(`DUPLICATE_ORDER: User ${userId} already purchased ${productId}`);
      }

      // 3. ตัดสต็อกสินค้าใน DB (การันตีไม่ติดลบ)
      product.remainingStock -= 1;
      await manager.save(product);

      // 4. บันทึกคำสั่งซื้อ
      const order = manager.create(Order, {
        userId,
        productId,
        status: 'completed',
      });
      await manager.save(order);

      this.logger.log(`✅ [Order Completed] User ${userId} successfully ordered ${productId}! Stock left: ${product.remainingStock}`);

      // 🧹 5. Cache Invalidation: ลบแคชรายการสินค้า เพื่อให้ API GET /products แสดงสต็อกล่าสุด
      await this.productsService.invalidateProductCache();

      return {
        success: true,
        orderId: order.id,
        remainingStock: product.remainingStock,
      };
    });
  }

  @OnQueueActive()
  onActive(job: Job) {
    this.logger.log(`🟡 [Order Job Active] Job ${job.id} started processing.`);
  }

  @OnQueueCompleted()
  onCompleted(job: Job, result: any) {
    this.logger.log(`🟢 [Order Job Completed] Job ${job.id} finished successfully!`);
  }

  @OnQueueFailed()
  onFailed(job: Job, error: Error) {
    this.logger.error(`🔴 [Order Job Failed] Job ${job.id} failed: ${error.message}`);
  }
}
