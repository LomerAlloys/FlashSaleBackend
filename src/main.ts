import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ValidationPipe } from '@nestjs/common'; 
import { Logger } from 'nestjs-pino'; // 📌 1. นำเข้า Logger จาก nestjs-pino (Part 6)

// นำเข้าเครื่องมือสำหรับ Bull Board (Monitoring)
import { ExpressAdapter } from '@bull-board/express';
import { createBullBoard } from '@bull-board/api';
import { BullAdapter } from '@bull-board/api/bullAdapter';
import { getQueueToken } from '@nestjs/bull';
import type { Queue } from 'bull';

async function bootstrap() {
  // 📌 2. เพิ่ม { bufferLogs: true } เพื่อบังคับให้ Log ทุกอย่างไปใช้ Pino
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  // 📌 3. สั่งให้แอปพลิเคชันใช้งาน Pino Logger (Part 6)
  app.useLogger(app.get(Logger));

  // เปิดใช้งานตรวจสอบข้อมูลทั่วทั้งแอป
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true, 
      forbidNonWhitelisted: true, 
    }),
  );

  // ==========================================
  // ตั้งค่า Bull Board สำหรับดูสถานะคิว
  // ==========================================
  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath('/admin/queues'); 

  const emailQueue = app.get<Queue>(getQueueToken('email'));

  createBullBoard({
    queues: [new BullAdapter(emailQueue)],
    serverAdapter,
  });

  app.use('/admin/queues', serverAdapter.getRouter());

  await app.listen(process.env.PORT ?? 3000);
  
  // 📌 4. ลองเปลี่ยนมาใช้ Logger ของ Nest แทน console.log แบบเดิม
  const logger = app.get(Logger);
  logger.log(`\n🚀 Server is running on: http://localhost:3000`);
  logger.log(`📊 Bull Board (Monitoring) is available at: http://localhost:3000/admin/queues\n`);
}
bootstrap();