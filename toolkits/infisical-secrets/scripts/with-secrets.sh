#!/usr/bin/env bash
# Runs a command with secrets from Infisical and removes them when it exits.
# See with-secrets.mjs for the options:  with-secrets.sh --file KEY_PATH=MY_SECRET -- node deploy.mjs
set -euo pipefail
exec node "$(dirname "${BASH_SOURCE[0]}")/with-secrets.mjs" "$@"
