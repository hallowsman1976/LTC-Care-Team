# Smart LTC Care

ต้นแบบระบบบริหารการดูแลระยะยาวสำหรับ รพ.สต. หนึ่งแห่ง ตาม `SMART_LTC_CARE_BLUEPRINT_GAS.md`

> ค่าเริ่มต้นยังเป็น **DEMO ONLY** และห้ามใช้กับข้อมูลผู้ป่วยจริง โค้ดมีโหมด `PILOT` แบบ fail-closed สำหรับเชื่อมข้อมูลจริงผ่าน Google Workspace identity เท่านั้น แต่ต้องผ่านรายการอนุมัติด้านกฎหมาย ความมั่นคงปลอดภัย อุปกรณ์ สำรองข้อมูล และ UAT ใน `docs/PILOT_RUNBOOK.md` ก่อนเปิดใช้งาน

## เริ่มใช้งานในเครื่อง

ต้องมี `pnpm` 11.25.0 อยู่ใน PATH เพราะสคริปต์ `check` เรียก `pnpm` ซ้อนอยู่ข้างใน การเรียกผ่าน `corepack pnpm check` จึงใช้ไม่ได้ บน Windows ที่ติดตั้ง Node ไว้ใน `Program Files` คำสั่ง `corepack enable` ต้องเปิด terminal แบบ Administrator หรือติดตั้งแทนด้วย `npm install -g pnpm@11.25.0`

```bash
pnpm install
pnpm dev
```

บัญชีจำลองอยู่ใน `scripts/seed-demo/README.md` และใช้ได้เฉพาะ local demo adapter

## ตรวจสอบคุณภาพ

```bash
pnpm check
pnpm test:e2e
```

อ่านข้อจำกัดและสถาปัตยกรรมใน `docs/SECURITY.md` และ `docs/DEPLOYMENT.md` ก่อนใช้งาน

การเตรียมข้อมูลจริง: อ่าน `docs/PILOT_RUNBOOK.md` และอย่าเปลี่ยน `APP_MODE` จนกว่าผู้รับผิดชอบทุกฝ่ายจะลงนามอนุมัติ

