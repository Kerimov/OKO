#!/usr/bin/env bash
# Back-compat wrapper — prefer ./start.sh
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/start.sh" "$@"
