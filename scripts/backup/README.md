# Backup

The workbook is copied nightly by the Apps Script job `backupWorkbook` (install once with `installBackupTrigger`; set `BACKUP_FOLDER_ID` and optionally `BACKUP_RETENTION_DAYS`, default 35). Each run is recorded in `JobRuns` as `WORKBOOK_BACKUP`.

The monthly encrypted offsite copy, the restore procedure and the restore drill are in `docs/pilot/BACKUP_DR.md`.
