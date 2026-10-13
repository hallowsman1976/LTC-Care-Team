# Load test

ใช้ก่อน pilot เพื่อหาว่า Google Sheets/GAS รับปริมาณข้อมูลและผู้ใช้พร้อมกันของหน่วยบริการได้หรือไม่ ทำกับ **DEMO workbook แยกต่างหากที่มีแต่ข้อมูลสังเคราะห์** เท่านั้น ทั้งสองเครื่องมือปฏิเสธการทำงานในโหมดอื่น

## 1. เตรียม workbook

1. สร้าง spreadsheet ใหม่สำหรับ load test โดยเฉพาะ แล้วตั้ง Script Properties ตาม `docs/DEPLOYMENT.md` (`APP_MODE=DEMO`) และเพิ่ม `LOAD_TEST_ALLOWED=true`
2. รัน `initializeDemoWorkbook` หนึ่งครั้ง
3. ใน Apps Script editor เพิ่มไฟล์ชั่วคราว เช่น

   ```js
   function seedLoad() {
     return seedLoadTestData({ patients: 100, caregivers: 10, months: 3, visitsPerWeek: 2, password: 'load-test-password-1' });
   }
   ```

   แล้วรันฟังก์ชันนี้ ค่าที่คืนกลับมาจะบอกจำนวนแถวที่สร้างในแต่ละชีตและเวลาที่ใช้ การรันหนึ่งครั้งจำกัดไว้ที่ 6 นาที จึงควรเริ่มจาก `months: 3` แล้วรันซ้ำเพื่อเพิ่มประวัติ (การรันซ้ำจะเพิ่มแถว ไม่ได้แทนที่ของเดิม)

   | สถานการณ์ | ตัวเลือก | ปริมาณโดยประมาณ |
   |---|---|---|
   | ใช้งาน 1 ปี | `patients: 100, months: 12` | VisitSchedules ~11,000, AuditLogs ~20,000 |
   | ใช้งาน 2 ปี | รันซ้ำอีกครั้งด้วย `months: 12` | ประมาณสองเท่า |

## 2. วัดเวลาฝั่ง server (ไม่รวม network)

รัน `runLoadProbe` จาก editor (หรือจากไฟล์ชั่วคราว `function probe() { return runLoadProbe(5); }`) ผลลัพธ์คือค่ามัธยฐานเป็นมิลลิวินาทีของแต่ละเส้นทาง พร้อมจำนวนแถวของชีตหลัก ฟังก์ชันนี้สร้างผลการเยี่ยมจริงใน DEMO workbook ด้วย

บันทึกผลทุกครั้งหลังเพิ่มข้อมูล เพื่อดูว่าเวลาเพิ่มตามขนาดข้อมูลอย่างไร

## 3. วัดแบบ end-to-end ผ่าน gateway พร้อมผู้ใช้หลายคน

```bash
BASE_URL=https://ltc-demo.example.org ACCOUNTS="load.cg.1:load-test-password-1,load.cg.2:load-test-password-1" CONCURRENCY=5 DURATION_SECONDS=120 node scripts/load-test/run.mjs
```

สคริปต์จะเช็ก `/health` ก่อน ถ้าไม่ใช่ `DEMO` จะหยุดทันที แต่ละ virtual user เปิด dashboard, รายการเยี่ยม และส่งผลเยี่ยมตามสัดส่วน `SUBMIT_RATIO` เมื่อจบจะแสดง p50/p95/p99 และชนิดของ error และ exit code เป็น 1 เมื่อเกินเกณฑ์ (`MAX_P95_MS`, `MAX_ERROR_RATE`)

ตั้ง `CONCURRENCY` ให้ใกล้กับจำนวนผู้ใช้ที่ใช้งานพร้อมกันจริงในช่วงพีค เช่น CG ส่งงานหลังเยี่ยมเสร็จช่วงเที่ยง แล้วลองเพิ่มเป็น 2 เท่าเพื่อดูว่ามีเผื่อพอหรือไม่

## การอ่านผล

- **การเขียนข้อมูลทุกครั้งต้องรอ script lock** (ตรวจ nonce และบันทึกข้อมูล) ระบบจึงรับการเขียนได้ทีละรายการ ถ้า p95 ของ `POST /visit-encounters` โตตาม `CONCURRENCY` แบบเกือบเป็นเส้นตรง แปลว่าติดคอขวดที่ lock
- **ถ้า `GET /dashboard` และ `listAll VisitSchedules` ช้าลงตามจำนวนแถว** แปลว่าติดที่การอ่านทั้งชีต ควรย้ายข้อมูลเก่าออก หรือวางแผนย้ายไปใช้ฐานข้อมูลจริง
- **Error `502 UPSTREAM_FAILED`** ให้ดูสาเหตุใน Worker log และใน Executions ของ Apps Script เช่น lock timeout หรือโควตา
- **เกณฑ์ที่แนะนำสำหรับตัดสินใจ pilot** (ปรับได้ตามที่หน่วยบริการยอมรับ): p95 ไม่เกิน 3 วินาทีสำหรับการเปิดหน้า, ไม่เกิน 5 วินาทีสำหรับการส่งงาน และ error ต่ำกว่า 1% ที่ปริมาณข้อมูล 2 ปีและผู้ใช้พร้อมกันช่วงพีคคูณ 2

ลบ workbook สำหรับ load test ทิ้งเมื่อทดสอบเสร็จ และอย่านำ `LOAD_TEST_ALLOWED` ไปตั้งใน workbook อื่น
