// src/students/mock-students.repository.ts
import { Injectable } from '@nestjs/common';

@Injectable()
export class MockStudentsRepository {
  findAll() {
    // คืนค่าข้อมูลจำลอง (Mock Data) ทันที
    return [{ id: '999', name: 'Mock Student', email: 'mock@test.com' }];
  }

  findOne(id: string) {
    return null;
  }

  create(student: any) {
    throw new Error('Simulated Database Error!');
  }
}