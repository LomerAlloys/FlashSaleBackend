import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { StudentsController } from './students.controller';
import { StudentsService } from './students.service';
import { Student } from './entities/student.entity';
import { EmailProcessor } from './email.processor';

@Module({
  imports: [TypeOrmModule.forFeature([Student])], // เพิ่มบรรทัดนี้
  controllers: [StudentsController],
  providers: [
    StudentsService,
    EmailProcessor
  ],
})
export class StudentsModule {}
