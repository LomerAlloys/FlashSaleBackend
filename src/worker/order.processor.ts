import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { UnrecoverableError, type Job } from 'bullmq';
import { Logger } from '@nestjs/common';
import { DataSource, QueryFailedError } from 'typeorm';
import { Product } from '../entities/product.entity';
import { Order } from '../entities/order.entity';
import { ProductsService } from '../products/products.service';

@Processor('order-queue', { concurrency: 5 })
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

    const result = await this.dataSource.transaction(async (manager) => {
      // 1. อ่านข้อมูลสินค้าพร้อมใส่ Pessimistic Write Lock
      const product = await manager.findOne(Product, {
        where: { productId },
        lock: { mode: 'pessimistic_write' },
      });

      if (!product) {
        throw new UnrecoverableError(`PRODUCT_NOT_FOUND: ${productId}`);
      }

      if (!product.isFlashSaleActive) {
        throw new UnrecoverableError(`FLASH_SALE_INACTIVE: ${productId}`);
      }

      if (product.remainingStock <= 0) {
        throw new UnrecoverableError(`OUT_OF_STOCK: Product ${productId} is sold out!`);
      }

      // 2. ตรวจสอบในตาราง Orders ป้องกันซื้อซ้ำ
      const existingOrder = await manager.findOne(Order, {
        where: { userId, productId },
      });

      if (existingOrder) {
        throw new UnrecoverableError(`DUPLICATE_ORDER: User ${userId} already purchased ${productId}`);
      }

      // 3. ตัดสต็อกสินค้าใน DB และบันทึกคำสั่งซื้อ
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
        if (err instanceof QueryFailedError) {
          const code = (err as QueryFailedError & { driverError?: { code?: string } }).driverError?.code;
          if (code === '23505' || code === '23514') {
            throw new UnrecoverableError(err.message);
          }
        }
        throw err;
      }

      return {
        success: true,
        orderId: order.id,
        remainingStock: product.remainingStock,
      };
    });

    // 🧹 Cache Invalidation หลัง commit
    await this.productsService.invalidateProductCache();

    return result;
  }
}
