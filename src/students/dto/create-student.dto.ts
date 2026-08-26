// src/students/dto/create-student.dto.ts
import { IsString, IsEmail, IsNotEmpty, IsInt, IsOptional } from 'class-validator';

export class CreateStudentDto {

  @IsInt()
  @IsOptional() // อนุญาตให้เว้นว่างได้ เผื่อกรณีสร้างนักศึกษาปกติที่ไม่เกี่ยวกับหลักสูตร
  remainingSeats?: number;

  @IsNotEmpty()
  name: string;

  @IsEmail()
  email: string;
}