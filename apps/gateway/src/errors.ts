import type { ApiEnvelope } from '@smart-ltc/shared';
import { failure, json } from './responses';

/** An error whose code and status are safe to show the client. */
export class HttpError extends Error {
  constructor(public status: number, code: string, public userMessage: string) { super(code); }
}

// Codes that the gateway itself raises, by status.
const GATEWAY_ERRORS: Record<string, [number, string]> = {
  INVALID_JSON: [400, 'รูปแบบข้อมูลไม่ถูกต้อง'],
  VALIDATION_FAILED: [400, 'ข้อมูลไม่ครบหรือไม่ถูกต้อง'],
  INVALID_CREDENTIALS: [401, 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง'],
  MFA_INVALID: [401, 'รหัสยืนยันไม่ถูกต้องหรือถูกใช้ไปแล้ว'],
  GOOGLE_IDENTITY_INVALID: [401, 'ไม่สามารถยืนยันบัญชี Google ได้'],
  HOSTED_DOMAIN_REQUIRED: [401, 'ต้องใช้บัญชีของหน่วยงานเท่านั้น'],
  MFA_ENROLLMENT_REQUIRED: [403, 'บัญชีนี้ยังไม่ได้ลงทะเบียนรหัสยืนยันสองชั้น กรุณาติดต่อผู้ดูแลระบบ'],
  CSRF_CHECK_FAILED: [403, 'ไม่สามารถดำเนินการได้'],
  ORIGIN_NOT_ALLOWED: [403, 'ไม่สามารถดำเนินการได้'],
  LOGIN_RATE_LIMITED: [429, 'พยายามเข้าสู่ระบบหลายครั้งเกินไป กรุณารอ 15 นาที']
};

// GAS business-rule codes that are meaningful to the user. Anything else (missing sheets, config,
// assertion failures) is an operator problem and is reported as UPSTREAM_FAILED.
const GAS_ERRORS: Record<string, [number, string]> = {
  INVALID_CREDENTIALS: [401, 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง'],
  VALIDATION_FAILED: [400, 'ข้อมูลไม่ครบหรือไม่ถูกต้อง'],
  SELF_APPROVAL_RATIONALE_REQUIRED: [400, 'การอนุมัติแผนที่ตนเองสร้างต้องระบุเหตุผลอย่างน้อย 10 ตัวอักษร'],
  FILE_SIZE_NOT_ALLOWED: [400, 'ขนาดไฟล์ต้องไม่เกิน 5 MB'],
  FORBIDDEN: [403, 'ไม่มีสิทธิ์ดำเนินการนี้'],
  CM_REQUIRED: [403, 'ต้องเป็นผู้จัดการการดูแล (CM)'],
  ACTOR_NOT_ALLOWED: [403, 'บัญชีนี้ไม่ได้รับอนุญาต'],
  CLINICAL_CREDENTIAL_INVALID: [403, 'ใบประกอบวิชาชีพหมดอายุหรือยังไม่ได้ตรวจสอบ'],
  VISIT_NOT_ASSIGNED: [403, 'งานเยี่ยมนี้ไม่ได้มอบหมายให้ท่าน'],
  ENCOUNTER_NOT_ASSIGNED: [403, 'บันทึกการเยี่ยมนี้ไม่ใช่ของท่าน'],
  PASSWORD_AUTH_DISABLED: [403, 'การเข้าสู่ระบบด้วยรหัสผ่านเปิดใช้เฉพาะโหมด DEMO'],
  NOT_FOUND: [404, 'ไม่พบรายการที่ร้องขอ'],
  PATIENT_NOT_FOUND: [404, 'ไม่พบผู้รับบริการ'],
  VERSION_CONFLICT: [409, 'ข้อมูลถูกแก้ไขโดยผู้อื่น กรุณาโหลดใหม่'],
  DUPLICATE_HN: [409, 'HN นี้มีอยู่แล้ว'],
  DUPLICATE_CID: [409, 'เลขประจำตัวประชาชนนี้มีอยู่แล้ว'],
  USERNAME_TAKEN: [409, 'ชื่อผู้ใช้นี้มีผู้ใช้แล้ว กรุณาเลือกชื่ออื่น'],
  CAREGIVER_NOT_FOUND: [404, 'ไม่พบผู้ดูแล (CG) หรือบัญชีถูกปิดใช้งาน'],
  ACTIVE_EPISODE_REQUIRED: [409, 'ผู้รับบริการยังไม่มีช่วงการดูแลที่เปิดอยู่'],
  MULTIPLE_ACTIVE_EPISODES: [409, 'ผู้รับบริการมีช่วงการดูแลที่เปิดอยู่มากกว่าหนึ่งช่วง กรุณาให้ผู้ดูแลระบบตรวจสอบ'],
  APPROVED_ADL_REQUIRED: [409, 'ต้องมีแบบประเมิน ADL ที่อนุมัติแล้วก่อน'],
  PLAN_NOT_ACTIVATABLE: [409, 'แผนนี้ไม่อยู่ในสถานะที่เปิดใช้ได้'],
  ACTIVE_EPISODE_WITH_LEGAL_BASIS_REQUIRED: [409, 'ช่วงการดูแลต้องเปิดอยู่และมีฐานการประมวลผล'],
  CONFIRMED_CLASSIFICATION_REQUIRED: [409, 'ต้องยืนยันกลุ่ม LTC ก่อน'],
  APPROVED_RULESET_REQUIRED: [409, 'ชุดกฎบริการยังไม่ได้รับอนุมัติ'],
  INTERVENTION_REQUIRED: [409, 'แผนต้องมีกิจกรรมอย่างน้อยหนึ่งรายการ'],
  ACTIVE_ASSIGNMENT_REQUIRED: [409, 'ต้องมอบหมายผู้ดูแลก่อน'],
  ACTIVE_CONSENT_REQUIRED: [409, 'ต้องมีความยินยอมที่ยังมีผล'],
  ENCOUNTER_NOT_REVIEWABLE: [409, 'รายการนี้ไม่อยู่ในสถานะรอตรวจ'],
  PARTIAL_COMMIT_REQUIRES_RECONCILIATION: [409, 'การส่งครั้งก่อนบันทึกไม่ครบ กรุณาแจ้งผู้ดูแลระบบ']
};

export function errorResponse(error: unknown): Response {
  if (error instanceof HttpError) return failure(error.status, error.message, error.userMessage);
  if (error instanceof SyntaxError) return failure(400, 'INVALID_JSON', GATEWAY_ERRORS.INVALID_JSON![1]);
  if (error instanceof Error && error.name === 'ZodError') return failure(400, 'VALIDATION_FAILED', GATEWAY_ERRORS.VALIDATION_FAILED![1]);
  const code = error instanceof Error ? error.message : '';
  const known = GATEWAY_ERRORS[code];
  if (known) return failure(known[0], code, known[1]);
  // Operators read the cause in Workers Logs; clients only learn that the server failed.
  console.error(JSON.stringify({ error: code || String(error), name: error instanceof Error ? error.name : typeof error }));
  return failure(500, 'INTERNAL_ERROR', 'ไม่สามารถดำเนินการได้');
}

export async function readGasEnvelope<T>(response: Response): Promise<ApiEnvelope<T>> {
  try {
    return await response.json() as ApiEnvelope<T>;
  } catch {
    // GAS returns an HTML page when the deployment is missing or not authorised.
    return { ok: false, code: 'UPSTREAM_NOT_JSON', message: '', data: null, requestId: '' };
  }
}

/** Translates a GAS envelope into a client response with a meaningful status. */
export async function relayGas(response: Response, requestId: string): Promise<Response> {
  const envelope = await readGasEnvelope<unknown>(response);
  if (envelope.ok) return json(200, { ...envelope, requestId });
  const known = GAS_ERRORS[envelope.code];
  if (known) return failure(known[0], envelope.code, known[1], requestId);
  console.warn(JSON.stringify({ requestId, upstreamCode: envelope.code }));
  return failure(502, 'UPSTREAM_FAILED', 'ระบบหลังบ้านไม่สามารถดำเนินการได้', requestId);
}

/** Returns the GAS data or throws an HttpError with the mapped status. */
export async function gasData<T>(response: Response): Promise<T> {
  const envelope = await readGasEnvelope<T>(response);
  if (envelope.ok && envelope.data !== null) return envelope.data;
  const known = GAS_ERRORS[envelope.code];
  if (known) throw new HttpError(known[0], envelope.code, known[1]);
  console.warn(JSON.stringify({ upstreamCode: envelope.code }));
  throw new HttpError(502, 'UPSTREAM_FAILED', 'ระบบหลังบ้านไม่สามารถดำเนินการได้');
}
