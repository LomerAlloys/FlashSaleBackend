import { Injectable, Inject, NotFoundException, BadRequestException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import type { Cache } from 'cache-manager';
import { Redis } from 'ioredis';
import { Student } from './entities/student.entity';
import { InjectQueue } from '@nestjs/bull'; // 📌 เพิ่ม import สำหรับ BullMQ
import type { Queue } from 'bull'; // 📌 เพิ่ม import สำหรับ BullMQ

@Injectable()
export class StudentsService implements OnModuleInit { // 📌 implements OnModuleInit
  constructor(
    @InjectRepository(Student)
    private readonly studentRepository: Repository<Student>,
    @Inject(CACHE_MANAGER) private cacheManager: Cache,
    @Inject('REDIS_CLIENT') private redis: Redis,
    
    // 📌 ของใหม่: Inject เครื่องมือสำหรับ Lab 5
    @Inject('REDIS_PUBLISHER') private redisPublisher: Redis,
    @Inject('REDIS_SUBSCRIBER') private redisSubscriber: Redis,
    @InjectQueue('email') private emailQueue: Queue,
  ) {}

  // 📌 ของใหม่ Part 1 & 2: ให้ระบบมารอ Subscribe ทันทีที่เปิดแอป
  onModuleInit() {
    this.redisSubscriber.subscribe('enrollment.created', (err) => {
      if (!err) console.log('✅ [Pub/Sub] Subscribed to "enrollment.created" channel!');
    });

    this.redisSubscriber.on('message', (channel, message) => {
      console.log(`\n📩 [Pub/Sub Subscriber] ได้รับ Event จากช่อง ${channel}:`);
      console.log(`   ข้อมูลที่ส่งมา: ${message}\n`);
    });
  }

  // 📌 ของใหม่ Part 1: ฟังก์ชันสำหรับยิงทดสอบ Pub/Sub เดี่ยวๆ
  async testPublish() {
    await this.redisPublisher.publish('enrollment.created', JSON.stringify({ 
      action: 'test.pubsub', 
      message: 'Hello from test-pubsub endpoint!' 
    }));
    return { success: true, message: 'ส่งข้อความ Pub/Sub แล้ว! ลองดูที่ Terminal นะครับ' };
  }

  async findAll(): Promise<Student[]> {
    return this.studentRepository.find();
  }

  async findOne(id: string): Promise<Student> {
    const cacheKey = `app:student:${id}`;
    const cachedStudent = await this.cacheManager.get<Student>(cacheKey);
    
    if (cachedStudent) {
      console.log(`Cache Hit for student ${id}`);
      return cachedStudent;
    }

    console.log(`Cache Miss for student ${id}. Fetching from DB...`);
    const student = await this.studentRepository.findOne({ where: { id } });
    if (!student) {
      throw new NotFoundException(`Student with ID ${id} not found`);
    }

    await this.cacheManager.set(cacheKey, student, 300000);
    return student;
  }

  async create(createStudentDto: Partial<Student>): Promise<Student> {
    const newStudent = this.studentRepository.create(createStudentDto);
    return this.studentRepository.save(newStudent);
  }

  async update(id: string, updateStudentDto: Partial<Student>): Promise<Student> {
    await this.studentRepository.update(id, updateStudentDto);
    const updatedStudent = await this.studentRepository.findOne({ where: { id } });
    
    if (!updatedStudent) throw new NotFoundException(`Student with ID ${id} not found`);

    await this.cacheManager.del(`app:student:${id}`);
    return updatedStudent;
  }

  // 📌 อัปเดตใหม่ Part 2 & 3: ใส่ Pub/Sub และ Message Queue หลังสมัครสำเร็จ
  async enroll(id: string): Promise<Student> {
    return await this.studentRepository.manager.transaction(async (transactionalEntityManager) => {
      const student = await transactionalEntityManager.findOne(Student, {
        where: { id },
        lock: { mode: 'pessimistic_write' }, 
      });

      if (!student) throw new NotFoundException('ไม่พบข้อมูล');
      if (student.remainingSeats <= 0) throw new BadRequestException('ที่นั่งเต็มแล้ว!');

      await new Promise(resolve => setTimeout(resolve, 500));

      student.remainingSeats -= 1;
      const updatedStudent = await transactionalEntityManager.save(student);
      await this.cacheManager.del(`app:student:${id}`);

      // ==========================================
      // ส่วนที่เพิ่มใหม่สำหรับ Lab 5
      // ==========================================
      
      // 1. [Part 2] Publish Event ว่ามีการสมัครเรียน
      const eventPayload = JSON.stringify({ 
        studentId: updatedStudent.id, 
        name: updatedStudent.name,
        email: updatedStudent.email, // สมมติว่ามีฟิลด์ email จากโจทย์เก่า
        action: 'enrollment.created',
        timestamp: new Date()
      });
      await this.redisPublisher.publish('enrollment.created', eventPayload);

      // 2. [Part 3] เอาข้อมูลโยนเข้า Message Queue เพื่อรอส่งอีเมลทีหลัง
      await this.emailQueue.add('send-welcome', {
        studentId: updatedStudent.id,
        name: updatedStudent.name,
        email: updatedStudent.email,
      });

      return updatedStudent;
    });
  }

  async getStudentSummary(): Promise<any> {
    const key = 'app:student:summary';
    const lockKey = `${key}:lock`;

    let cached = await this.cacheManager.get(key);
    if (cached) return cached;

    const lockAcquired = await this.redis.set(lockKey, '1', 'EX', 10, 'NX');
    if (lockAcquired) {
      try {
        console.log('Lock acquired. Querying DB...');
        const total = await this.studentRepository.count();
        const summary = { total, timestamp: new Date() };
        await this.cacheManager.set(key, summary, 5000);
        return summary;
      } finally {
        await this.redis.del(lockKey);
      }
    } else {
      console.log('Waiting for lock...');
      await new Promise(resolve => setTimeout(resolve, 100));
      return this.getStudentSummary();
    }
  }

  async incrementStudentView(id: string): Promise<number> {
    const key = `app:student:${id}:views`;
    return await this.redis.incr(key);
  }

  async sendConfirmationEmail(studentId: string): Promise<string> {
    const lockKey = `lock:email:${studentId}`;
    const acquired = await this.redis.set(lockKey, 'locked', 'EX', 10, 'NX');
    
    if (!acquired) {
      throw new BadRequestException('อีเมลนี้กำลังถูกประมวลผลโดยระบบอื่นอยู่แล้ว');
    }
    try {
      console.log(`Processing email for student ${studentId}...`);
      await new Promise(resolve => setTimeout(resolve, 3000));
      return `Email sent successfully for student ${studentId}.`;
    } finally {
      await this.redis.del(lockKey);
    }
  }
}