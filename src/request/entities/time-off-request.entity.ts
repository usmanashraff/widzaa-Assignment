import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  VersionColumn,
} from 'typeorm';
import { RequestStatus } from '../../common/enums';

@Entity('time_off_request')
export class TimeOffRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ name: 'employee_id' })
  employeeId: string;

  @Column({ name: 'location_id' })
  locationId: string;

  @Column({ name: 'leave_type' })
  leaveType: string;

  @Column({ name: 'start_date', type: 'date' })
  startDate: string;

  @Column({ name: 'end_date', type: 'date' })
  endDate: string;

  @Column({ name: 'days_requested', type: 'decimal', precision: 5, scale: 1 })
  daysRequested: number;

  @Column({ name: 'status', type: 'varchar', default: RequestStatus.PENDING })
  status: RequestStatus;

  @Column({ name: 'hcm_reference_id', nullable: true })
  hcmReferenceId: string;

  @Column({ name: 'rejection_reason', nullable: true })
  rejectionReason: string;

  @VersionColumn()
  version: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
