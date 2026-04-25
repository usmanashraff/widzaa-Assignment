import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
} from 'typeorm';
import { ChangeSource } from '../../common/enums';

@Entity('balance_audit_log')
export class BalanceAuditLog {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'employee_id' })
  employeeId: string;

  @Column({ name: 'location_id' })
  locationId: string;

  @Column({ name: 'leave_type' })
  leaveType: string;

  @Column({ name: 'previous_balance', type: 'decimal', precision: 5, scale: 1 })
  previousBalance: number;

  @Column({ name: 'new_balance', type: 'decimal', precision: 5, scale: 1 })
  newBalance: number;

  @Column({ name: 'change_source', type: 'varchar' })
  changeSource: ChangeSource;

  @Column({ name: 'reference_id', nullable: true })
  referenceId: string;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;
}
