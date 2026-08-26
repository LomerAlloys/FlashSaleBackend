import { Entity, PrimaryGeneratedColumn, Column } from 'typeorm';

@Entity('students') // กำหนดชื่อตารางในฐานข้อมูล
export class Student {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  name: string;

  @Column()
  email: string;

  @Column({ type: 'int', default: 0 })
  remainingSeats: number;

  // หากในแล็บ 2 คุณมีตัวแปรอื่นในข้อมูลนักศึกษา (เช่น major, age) ให้เพิ่ม @Column() แบบนี้เข้าไปด้วยครับ
}