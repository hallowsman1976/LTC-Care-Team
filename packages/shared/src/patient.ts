// Choices on the patient registration form, as [stored value, Thai label]. Stored values are
// stable codes so reports do not depend on wording.

export const SEX_OPTIONS = [['FEMALE', 'หญิง'], ['MALE', 'ชาย'], ['OTHER', 'อื่น ๆ'], ['UNKNOWN', 'ไม่ระบุ']] as const;

export const RELATIONSHIP_OPTIONS = [
  ['SPOUSE', 'คู่สมรส'], ['CHILD', 'บุตร'], ['CHILD_IN_LAW', 'บุตรเขย/สะใภ้'], ['GRANDCHILD', 'หลาน'], ['SIBLING', 'พี่น้อง'],
  ['RELATIVE', 'ญาติอื่น'], ['NEIGHBOR', 'เพื่อนบ้าน'], ['HIRED', 'ผู้ดูแลที่จ้าง'], ['OTHER', 'อื่น ๆ']
] as const;

export const RIGHT_TYPE_OPTIONS = [
  ['UC', 'หลักประกันสุขภาพถ้วนหน้า (บัตรทอง)'], ['CSMBS', 'ข้าราชการ/รัฐวิสาหกิจ'], ['SSS', 'ประกันสังคม'],
  ['LGO', 'พนักงานส่วนท้องถิ่น (อปท.)'], ['SELF_PAY', 'ชำระเอง'], ['OTHER', 'อื่น ๆ']
] as const;

/** Common conditions offered as one-tap choices; anything else is typed in. */
export const COMMON_DISEASES = ['ความดันโลหิตสูง', 'เบาหวาน', 'โรคหลอดเลือดสมอง', 'โรคหัวใจ', 'ไตวายเรื้อรัง', 'สมองเสื่อม', 'ข้อเข่าเสื่อม', 'โรคปอดอุดกั้นเรื้อรัง', 'มะเร็ง', 'พาร์กินสัน'] as const;

/** Dependency by Barthel ADL, as the LTC programme groups it. */
export const DEPENDENCY_OPTIONS = [
  ['SOCIAL', 'ติดสังคม (ADL 12–20)'], ['HOMEBOUND', 'ติดบ้าน (ADL 5–11)'], ['BEDBOUND', 'ติดเตียง (ADL 0–4)']
] as const;

export type DependencyStatus = (typeof DEPENDENCY_OPTIONS)[number][0];

export function dependencyFromAdl(score: number): DependencyStatus {
  if (score >= 12) return 'SOCIAL';
  if (score >= 5) return 'HOMEBOUND';
  return 'BEDBOUND';
}

/** TAI (Typology of Aged with Illustration) groups: I = ติดสังคม, C = ติดบ้าน, B = ติดเตียง. */
export const TAI_GROUP_OPTIONS = [
  ['I1', 'I1 (ติดสังคม)'], ['I2', 'I2 (ติดสังคม)'], ['I3', 'I3 (ติดสังคม)'],
  ['C2', 'C2 (ติดบ้าน)'], ['C3', 'C3 (ติดบ้าน)'], ['C4', 'C4 (ติดบ้าน)'],
  ['B3', 'B3 (ติดเตียง)'], ['B4', 'B4 (ติดเตียง)'], ['B5', 'B5 (ติดเตียง)']
] as const;

/** Palliative Performance Scale, 10–100 in steps of 10. */
export const PPS_OPTIONS = [100, 90, 80, 70, 60, 50, 40, 30, 20, 10] as const;

export const MENTAL_HEALTH_OPTIONS = [
  ['NORMAL', 'ปกติ'], ['STRESS', 'เครียด/วิตกกังวล'], ['DEPRESSION_RISK', 'เสี่ยงซึมเศร้า'], ['DEPRESSION', 'ซึมเศร้า'],
  ['COGNITIVE_IMPAIRMENT', 'สมองเสื่อม/บกพร่องทางการรับรู้'], ['OTHER', 'อื่น ๆ'], ['NOT_ASSESSED', 'ยังไม่ได้ประเมิน']
] as const;

export const PATIENT_STATUS_OPTIONS = [['ACTIVE', 'รับบริการ'], ['INACTIVE', 'พักการดูแล'], ['MOVED', 'ย้ายออก'], ['DECEASED', 'เสียชีวิต']] as const;

export const labelOf = (options: ReadonlyArray<readonly [string, string]>, value: unknown) => options.find(([key]) => key === value)?.[1] ?? '';
