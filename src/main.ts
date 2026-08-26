import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common'; 
import { Logger } from 'nestjs-pino';

// นำเข้าเครื่องมือสำหรับ Bull Board (Monitoring)
import { ExpressAdapter } from '@bull-board/express';
import { createBullBoard } from '@bull-board/api';
import { BullAdapter } from '@bull-board/api/bullAdapter';
import { getQueueToken } from '@nestjs/bull';
import type { Queue } from 'bull';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.useLogger(app.get(Logger));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // ตั้งค่า Prefix ทุก Endpoint เป็น /api/v1 (ตามข้อกำหนด API Specs)
  app.setGlobalPrefix('api/v1');

  // ==========================================
  // ตั้งค่า Bull Board Dashboard สำหรับดูสถานะคิว
  // ==========================================
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath('/admin/queues'); 

  try {
    const ordersQueue = app.get<Queue>(getQueueToken('orders'));
    createBullBoard({
      queues: [new BullAdapter(ordersQueue)],
      serverAdapter,
    });
    app.use('/admin/queues', serverAdapter.getRouter());
  } catch (err) {
    console.error('Bull Board setup error:', err);
  }

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
  
  const logger = app.get(Logger);
  logger.log(`\n🚀 Flash Sale Backend is running on: http://localhost:${port}/api/v1`);
  logger.log(`📊 Bull Board (Monitoring Dashboard) is available at: http://localhost:${port}/admin/queues\n`);
}
bootstrap();