# Smart LTC Care

ต้นแบบระบบบริหารการดูแลระยะยาวสำหรับ รพ.สต. หนึ่งแห่ง ตาม `SMART_LTC_CARE_BLUEPRINT_GAS.md`

> การติดตั้งบน Cloudflare ตั้งเป็นโหมด **PILOT** (ข้อมูลจริง) เข้าสู่ระบบด้วยรหัสผ่าน + รหัส 6 หลักจากแอป Authenticator ทุกบทบาท ขั้นตอนเปลี่ยนระบบอยู่ใน `docs/PILOT_CUTOVER.md` ห้ามนำข้อมูลผู้ป่วยจริงเข้าจนกว่า gate ใน `docs/PILOT_RUNBOOK.md` จะได้รับการลงนาม เอกสาร PDPA, การรับมือเหตุ และการสำรองข้อมูลอยู่ใน `docs/pilot/` การพัฒนาในเครื่อง (`pnpm dev`) และหน้าตัวอย่างบน GitHub Pages ยังเป็น DEMO ที่ใช้ข้อมูลสมมติ

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

การเตรียมข้อมูลจริง: ทำตาม `docs/PILOT_CUTOVER.md` แล้วลงนาม gate ใน `docs/PILOT_RUNBOOK.md` ก่อนนำข้อมูลจริงเข้า

