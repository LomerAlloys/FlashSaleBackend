import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { Order } from '../entities/order.entity';
import { Product } from '../entities/product.entity';
import { OrdersService } from './orders.service';
import { OrderProcessor } from '../worker/order.processor';
import { OrdersController } from './orders.controller';
import { ProductsModule } from '../products/products.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order, Product]),
    BullModule.registerQueue({
      name: 'order-queue',
    }),
    ProductsModule,
    AuthModule,
  ],
  controllers: [OrdersController],
  providers: [OrdersService, OrderProcessor],
  exports: [OrdersService],
})
export class OrdersModule {}
