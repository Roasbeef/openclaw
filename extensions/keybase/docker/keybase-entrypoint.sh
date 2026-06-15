#!/usr/bin/env sh
set -eu

# Parse files in $dir (sorted) and export only well-formed KEY=VALUE lines.
# This deliberately does NOT source the files: we don't want vault-secret
# files to be able to execute arbitrary shell as the bot user (H-7).
source_env_dir() {
  dir=$1
  [ -d "$dir" ] || return 0

  for file in "$dir"/*.sh; do
    [ -f "$file" ] || continue
    if [ "${OPENCLAW_KEYBASE_DEBUG:-0}" = "1" ]; then
      echo "openclaw-keybase: parsing ${file}" >&2
    fi
    while IFS= read -r line || [ -n "$line" ]; do
      # strip trailing CR (CRLF files)
      line=${line%$(printf '\r')}
      case "$line" in
        '' | '#'*) continue ;;
      esac
      # allow optional `export ` prefix
      case "$line" in
        export\ *) line=${line#export } ;;
      esac
      # require a NAME=...; NAME must match [A-Z_][A-Z0-9_]*
      case "$line" in
        [A-Z_]*=*) ;;
        *)
          echo "openclaw-keybase: rejecting non KEY=VALUE line in ${file}" >&2
          continue
          ;;
      esac
      name=${line%%=*}
      value=${line#*=}
      # validate name strictly
      case "$name" in
        *[!A-Z0-9_]* | [0-9]*)
          echo "openclaw-keybase: rejecting invalid env name '${name}' in ${file}" >&2
          continue
          ;;
      esac
      # strip a single matching pair of surrounding quotes (no escape handling).
      first=${value%"${value#?}"}
      last=${value#"${value%?}"}
      if [ -n "$value" ] && [ "$first" = "$last" ] && { [ "$first" = '"' ] || [ "$first" = "'" ]; }; then
        value=${value#?}
        value=${value%?}
      fi
      export "$name=$value"
    done < "$file"
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

# Defense-in-depth: the canonical entrypoint always sits next to this wrapper.
# Deriving the allowed prefix from the wrapper's own directory makes this work
# in both prod (/app/extensions/keybase/docker/) and any dev/test layout while
# still constraining the override to a path co-located with the wrapper.
script_dir=$(cd -- "$(dirname -- "$0")" && pwd)
default_entrypoint="${script_dir}/container-entrypoint.mjs"
container_entrypoint=${OPENCLAW_KEYBASE_CONTAINER_ENTRYPOINT:-$default_entrypoint}

if [ "$container_entrypoint" != "$default_entrypoint" ]; then
  if [ "${OPENCLAW_KEYBASE_TESTING:-0}" != "1" ]; then
    echo "openclaw-keybase: refusing OPENCLAW_KEYBASE_CONTAINER_ENTRYPOINT override outside testing mode" >&2
    exit 1
  fi
  case "$container_entrypoint" in
    "${script_dir}"/*) ;;
    *)
      echo "openclaw-keybase: OPENCLAW_KEYBASE_CONTAINER_ENTRYPOINT must live under ${script_dir}/" >&2
      exit 1
      ;;
  esac
fi

exec node "$container_entrypoint" "$@"
