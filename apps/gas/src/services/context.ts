import { getById, listAll, type RowRecord } from '../repositories/sheets';

// Clinical context is derived on the server from the patient, never accepted from the client.

export function resolveActiveEpisode(patientId: string): RowRecord {
  if (!getById('Patients', 'patientId', patientId)) throw new Error('PATIENT_NOT_FOUND');
  const active = listAll('CareEpisodes', (row) => String(row.patientId) === patientId && String(row.status) === 'ACTIVE');
  if (active.length === 0) throw new Error('ACTIVE_EPISODE_REQUIRED');
  if (active.length > 1) throw new Error('MULTIPLE_ACTIVE_EPISODES');
  return active[0]!;
}

/** The most recent APPROVED assessment by assessment date, then creation time. */
export function latestApprovedAdl(episodeId: string): RowRecord {
  const approved = listAll('ADLAssessments', (row) => String(row.episodeId) === episodeId && String(row.status) === 'APPROVED');
  const sortKey = (row: RowRecord) => `${String(row.assessmentDate)}|${String(row.createdAt)}`;
  const latest = approved.sort((left, right) => sortKey(right).localeCompare(sortKey(left)))[0];
  if (!latest) throw new Error('APPROVED_ADL_REQUIRED');
  return latest;
}
