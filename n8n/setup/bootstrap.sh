#!/bin/sh
# Runs inside the n8n container (see n8n/setup.sh). Idempotent: re-running
# overwrites the credential and workflows with the same ids.
set -eu

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# The SMTP credential is built from environment variables at import time, so
# no password ever lives in the repository or in the exported workflows.
node -e '
const env = process.env;
const credential = [{
  id: "lendloopSmtp0001",
  name: "LendLoop SMTP",
  type: "smtp",
  data: {
    host: env.LENDLOOP_SMTP_HOST || "mailpit",
    port: Number(env.LENDLOOP_SMTP_PORT || 1025),
    secure: env.LENDLOOP_SMTP_SECURE === "true",
    disableStartTls: env.LENDLOOP_SMTP_SECURE !== "true" && !env.LENDLOOP_SMTP_USER,
    user: env.LENDLOOP_SMTP_USER || "",
    password: env.LENDLOOP_SMTP_PASSWORD || "",
  },
}];
require("fs").writeFileSync(process.argv[1], JSON.stringify(credential));
' "$tmp/credentials.json"

n8n import:credentials --input="$tmp/credentials.json"
n8n import:workflow --separate --input=/lendloop/workflows

# n8n only runs a published error workflow, so all three get published.
n8n publish:workflow --id=lendloopErrors01
n8n publish:workflow --id=lendloopLoanEvt1
n8n publish:workflow --id=lendloopOverdue1
