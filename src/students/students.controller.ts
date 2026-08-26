import { Controller, Get, Post, Body, Patch, Param } from '@nestjs/common';
import { StudentsService } from './students.service';
import { Student } from './entities/student.entity';

@Controller('students')
export class StudentsController {
  constructor(private readonly studentsService: StudentsService) {}

  // ==========================================
  // Part 4: Cache Stampede
  // (ต้องวางไว้บนสุด เพื่อไม่ให้คำว่า 'summary' ไปชนกับ ':id')
  // ==========================================
  @Get('report/summary')
  async getSummary() {
    return this.studentsService.getStudentSummary();
  }

  @Get()
  findAll() {
    return this.studentsService.findAll();
  }

  // ==========================================
  // Part 2: Cache-Aside Pattern
  // ==========================================
  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.studentsService.findOne(id);
  }

  @Post()
  create(@Body() createStudentDto: Partial<Student>) {
    return this.studentsService.create(createStudentDto);
  }

  // ==========================================
  // Part 3: Cache Invalidation เมื่ออัปเดตข้อมูล
  // ==========================================
  @Patch(':id')
  update(@Param('id') id: string, @Body() updateStudentDto: Partial<Student>) {
    return this.studentsService.update(id, updateStudentDto);
  }

  // ==========================================
  // ของเดิมจาก Lab 3: อัปเดตข้อมูลและลบแคช (Part 3)
  // ==========================================
  @Post(':id/enroll')
  enroll(@Param('id') id: string) {
    return this.studentsService.enroll(id);
  }

  // ==========================================
  // Part 5: Atomic Counter ด้วย INCR
  // ==========================================
  @Post(':id/views')
  incrementView(@Param('id') id: string) {
    return this.studentsService.incrementStudentView(id);
  }

  // ==========================================
  // Part 6: Distributed Lock ป้องกันประมวลผลซ้ำ
  // ==========================================
  @Post(':id/email')
  sendEmail(@Param('id') id: string) {
    return this.studentsService.sendConfirmationEmail(id);
  }

  @Post('test-pubsub')
  testPubSub() {
    return this.studentsService.testPublish();
  }
}