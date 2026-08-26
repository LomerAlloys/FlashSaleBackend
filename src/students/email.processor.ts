// src/students/email.processor.ts
import { Processor, Process, OnQueueFailed, OnQueueCompleted } from '@nestjs/bull'; // 📌 เพิ่ม import OnQueueFailed, OnQueueCompleted
import { Logger } from '@nestjs/common';
import type { Job } from 'bull';

@Processor('email') // 📌 ระบุว่าคลาสนี้ทำหน้าที่ประมวลผล Queue ชื่อ 'email'
export class EmailProcessor {
  private readonly logger = new Logger(EmailProcessor.name);

  @Process('send-welcome') // 📌 ระบุชื่องาน (Job name) ให้ตรงกับตอนที่เรา .add()
  async handleSendWelcome(job: Job) {
    this.logger.debug(`[Job ID: ${job.id}] 🚀 เริ่มประมวลผลส่งอีเมลหา: ${job.data.email}...`);
    
    // ==========================================
    // Part 4: จำลอง Permanent Failure (ความล้มเหลวถาวร)
    // ==========================================
    if (job.data.email === 'invalid@example.com') {
      this.logger.error(`❌ [Permanent Failure] อีเมล ${job.data.email} ไม่มีอยู่จริง! ปฏิเสธการส่งทันที`);
      return; 
    }

    // ==========================================
    // Part 4: จำลอง Transient Failure (ความล้มเหลวชั่วคราว)
    // ==========================================
    if (job.attemptsMade < 2) {
      this.logger.warn(`⚠️ [Transient Failure] เชื่อมต่อ SMTP ไม่สำเร็จ (Attempt: ${job.attemptsMade}). ระบบจะลองใหม่ตามคิว...`);
      throw new Error('TRANSIENT_FAILURE: SMTP Connection timeout');
    }

    // ==========================================
    // ส่วนจำลองการทำงานสำเร็จ
    // ==========================================
    this.logger.log(`⏳ กำลังส่งอีเมล... (จำลองโหลด 2 วินาที)`);
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    this.logger.log(`✅ [Success] ส่งอีเมลต้อนรับถึง ${job.data.email} สำเร็จเรียบร้อยแล้ว!`);
  }

  // ==========================================
  // Part 5: Event Listeners ดักจับสถานะของ Job (Dead Letter Queue)
  // ==========================================
  
  @OnQueueCompleted()
  onCompleted(job: Job) {
    this.logger.debug(`🎉 [Event] Job ${job.id} ทำงานเสร็จสมบูรณ์แล้วและถูกนำออกจากคิว`);
  }

  @OnQueueFailed()
  onFailed(job: Job, err: Error) {
    this.logger.error(`🚨 [Event] Job ${job.id} ล้มเหลว: ${err.message}`);
    
    // ตรวจสอบว่าพยายามทำซ้ำจนครบโควต้า (attempts) หรือยัง
    if (job.attemptsMade >= (job.opts.attempts || 3)) {
      this.logger.error(`☠️ [Dead Letter Queue] Job ${job.id} ล้มเหลวถาวร (ลองครบ ${job.attemptsMade} ครั้งแล้ว)!`);
      this.logger.error(`👉 ควรนำข้อมูลของ Job นี้บันทึกลง Database หรือแจ้งเตือนให้แอดมินมาตรวจสอบภายหลัง`);
    }
  }
}