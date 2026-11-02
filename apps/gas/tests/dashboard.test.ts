import { beforeEach, describe, expect, it } from 'vitest';
import { installFakeGas, parseOutput, seed, signedEvent } from './fakeGas';
import { doPost } from '../src/main';

interface Summary { dueToday: number; overdue: number; followUpVisits: Array<Record<string, unknown>> }

const summaryFor = (subject: string) => parseOutput(doPost(signedEvent('dashboard.summary', subject, {}))).data as Summary;
const visit = (visitId: string, date: string, status: string, assignedStaffId = 'usr-cg') =>
  ({ visitId, episodeId: 'ep-1', assignedStaffId, visitDateTime: `${date}T09:00:00+07:00`, visitType: 'เยี่ยมบ้าน', status });

beforeEach(() => {
  installFakeGas();
  seed('Users', [{ userId: 'usr-cg', role: 'CG', enabled: 'true' }, { userId: 'usr-cg-2', role: 'CG', enabled: 'true' }, { userId: 'usr-cm', role: 'CM', enabled: 'true' }]);
  seed('StaffProfiles', [{ staffId: 'st-cm', userId: 'usr-cm', credentialVerifiedAt: '2026-01-01', qualificationExpiry: '2099-01-01T00:00:00.000Z' }]);
  seed('CareEpisodes', [{ episodeId: 'ep-1', patientId: 'pt-1' }]);
  seed('Patients', [{ patientId: 'pt-1', hn: 'HN-1', fullName: 'นางสมศรี ตัวอย่าง' }]);
});

describe('dashboard follow-up visits', () => {
  it('lists the five oldest open visits, wherever they sit in the sheet', () => {
    seed('VisitSchedules', [
      ...Array.from({ length: 60 }, (_, index) => visit(`vs-done-${index}`, '2020-01-01', 'VERIFIED')),
      visit('vs-cancelled', '2020-01-02', 'CANCELLED'),
      visit('vs-6', '2026-06-06', 'ASSIGNED'),
      visit('vs-5', '2026-05-05', 'PLANNED'),
      visit('vs-4', '2026-04-04', 'MISSED'),
      visit('vs-3', '2026-03-03', 'RETURNED'),
      visit('vs-2', '2026-02-02', 'SUBMITTED'),
      visit('vs-1', '2026-01-01', 'IN_PROGRESS')
    ]);
    expect(summaryFor('usr-cm').followUpVisits.map((row) => row.visitId)).toEqual(['vs-1', 'vs-2', 'vs-3', 'vs-4', 'vs-5']);
  });

  it('shows a caregiver only their own visits', () => {
    seed('VisitSchedules', [visit('vs-mine', '2026-02-02', 'ASSIGNED'), visit('vs-other', '2026-01-01', 'ASSIGNED', 'usr-cg-2')]);
    expect(summaryFor('usr-cg').followUpVisits.map((row) => row.visitId)).toEqual(['vs-mine']);
  });

  it('names the patient and leaves out the HN', () => {
    seed('VisitSchedules', [visit('vs-1', '2026-01-01', 'ASSIGNED')]);
    const [row] = summaryFor('usr-cm').followUpVisits;
    expect(row).toMatchObject({ patientName: 'นางสมศรี ตัวอย่าง', status: 'ASSIGNED', visitType: 'เยี่ยมบ้าน' });
    expect(JSON.stringify(row)).not.toContain('HN-1');
  });

  it('returns an empty list when nothing is open', () => {
    seed('VisitSchedules', [visit('vs-done', '2026-01-01', 'VERIFIED')]);
    expect(summaryFor('usr-cm')).toMatchObject({ overdue: 0, followUpVisits: [] });
  });
});
