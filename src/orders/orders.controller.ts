import { Controller, Post, Body, UseGuards, Request, HttpCode, HttpStatus } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.ACCEPTED) // 202 Accepted
  createOrder(@Request() req: any, @Body() body: { productId: string }) {
    const userId = req.user.sub;
    return this.ordersService.createOrder(userId, body.productId);
  }
}
