import { Controller, Get, Query } from '@nestjs/common';
import { ProductsService } from './products.service';

@Controller('products')
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Get()
  getProducts(
    @Query('page') page: string = '1',
    @Query('limit') limit: string = '10',
  ) {
    const pageNum = parseInt(page, 10) || 1;
    const limitNum = parseInt(limit, 10) || 10;
    return this.productsService.findAll(pageNum, limitNum);
  }

  // 📊 Cache Hit/Miss Ratio สำหรับ Dashboard/Report
  @Get('cache-stats')
  getCacheStats() {
    return this.productsService.getCacheStats();
  }
}
