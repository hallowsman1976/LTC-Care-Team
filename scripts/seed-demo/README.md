# Synthetic demo seed

This directory contains synthetic fixtures only. Names, addresses, HNs and CID-like strings are deliberately marked as demo data. CID display fixtures do not pass the Thai citizen-ID checksum.

Demo roles:

- `admin` — aggregate administration only
- `cm` — clinical manager capabilities for workflow testing
- `cg` — one assigned patient and visit tasks only

The browser role selector is not authentication and is accepted only when Worker `APP_MODE=DEMO` is enforced.

