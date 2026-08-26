// src/students/students.repository.ts
import { Injectable } from '@nestjs/common';

@Injectable()
export class StudentsRepository {
  // ย้าย Array เก็บข้อมูลมาไว้ที่นี่แทน
  private readonly students: any[] = [];

  findAll() {
    return this.students;
  }

  findOne(id: string) {
    return this.students.find(student => student.id === id);
  }

  create(student: any) {
    const newStudent = { id: Date.now().toString(), ...student };
    this.students.push(newStudent);
    return newStudent;
  }
}