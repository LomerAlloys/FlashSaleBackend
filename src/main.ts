import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common';
import { Logger } from 'nestjs-pino';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

import { ExpressAdapter } from '@bull-board/express';
import { createBullBoard } from '@bull-board/api';
import { BullMQAdapter } from '@bull-board/api/bullMQAdapter';
import { getQueueToken } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.enableCors();
  app.useLogger(app.get(Logger));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new HttpExceptionFilter());

  // Setup Bull Board
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath('/admin/queues'); 

  try {
    const ordersQueue = app.get<Queue>(getQueueToken('order-queue'));
    createBullBoard({
      queues: [new BullMQAdapter(ordersQueue)],
      serverAdapter,
    });
    app.use('/admin/queues', serverAdapter.getRouter());
  } catch (err) {
    console.error('Bull Board setup error:', err);
  }

  const port = process.env.PORT ?? 3000;
  const server = await app.listen(port);
  
  // ⚡ Tune Node.js HTTP Server for 50,000 Concurrent Keep-Alive Connections
  if (server && server.keepAliveTimeout !== undefined) {
    server.keepAliveTimeout = 65000;
    server.headersTimeout = 66000;
    server.maxConnections = 50000;
  }
}
bootstrap();
