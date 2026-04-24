#!/usr/bin/env sh
set -eu

source_env_dir() {
  dir=$1
  [ -d "$dir" ] || return 0

  for file in "$dir"/*.sh; do
    [ -f "$file" ] || continue
    echo "Sourcing ${file}..."
    set -a
    # shellcheck disable=SC1090
    . "$file"
    set +a
  done
}

if [ "${OPENCLAW_SOURCE_SECRET_ENV:-1}" != "0" ]; then
  source_env_dir "${OPENCLAW_SECRET_ENV_DIR:-/vault/secrets}"
fi

if [ "${OPENCLAW_CONFIGURE_GITHUB_TOKEN:-0}" = "1" ] && [ -n "${GITHUB_TOKEN:-}" ]; then
  if command -v git >/dev/null 2>&1; then
    git config --global credential.helper store
    printf 'https://x-access-token:%s@github.com\n' "$GITHUB_TOKEN" > "${HOME}/.git-credentials"
    chmod 600 "${HOME}/.git-credentials"
    git config --global url."https://github.com/".insteadOf "git@github.com:"
  fi
  if command -v gh >/dev/null 2>&1; then
    printf '%s\n' "$GITHUB_TOKEN" | gh auth login --with-token >/dev/null 2>&1 || true
  fi
fi

container_entrypoint=${OPENCLAW_KEYBASE_CONTAINER_ENTRYPOINT:-/app/extensions/keybase/docker/container-entrypoint.mjs}
exec node "$container_entrypoint" "$@"
