import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bull';
import { Order } from './entities/order.entity';
import { Product } from '../products/entities/product.entity';
import { OrdersService } from './orders.service';
import { OrdersProcessor } from './orders.processor';
import { OrdersController } from './orders.controller';
import { ProductsModule } from '../products/products.module';
import { AuthModule } from '../auth/auth.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order, Product]),
    BullModule.registerQueue({
      name: 'orders',
    }),
    ProductsModule,
    AuthModule,
  ],
  controllers: [OrdersController],
  providers: [OrdersService, OrdersProcessor],
  exports: [OrdersService],
})
export class OrdersModule {}
