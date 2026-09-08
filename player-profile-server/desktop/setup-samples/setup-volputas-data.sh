#!/usr/bin/env sh
set -eu

# The company's own private data repository — there is no default. Companies must
# not end up silently cloning the public LUDIARS/VolputasData template into Local
# Settings; requiring this argument makes that a usage error instead of a possibility.
if [ "${1:-}" = '' ]; then
  cat >&2 <<'USAGE'
Usage: setup-volputas-data.sh <repository-url> [target-path] [config-path]

<repository-url> is your own private GitHub data repository (for example a copy
made from the LUDIARS/VolputasData template). There is no default: pass it
explicitly.
USAGE
  exit 1
fi

repository_url="$1"
target_path="${2:-$HOME/VolputasData}"
config_root="${XDG_CONFIG_HOME:-$HOME/.config}"
config_path="${3:-$config_root/Volputas/local-config.json}"

if ! command -v git >/dev/null 2>&1; then
  echo 'Git CLI was not found in PATH. Install Git and restart the terminal.' >&2
  exit 1
fi
if ! command -v gh >/dev/null 2>&1; then
  echo 'GitHub CLI ("gh") was not found in PATH. Install it and run "gh auth login", then retry.' >&2
  exit 1
fi

if [ -d "$target_path/.git" ]; then
  git -C "$target_path" remote get-url origin >/dev/null
elif [ -e "$target_path" ]; then
  echo "Target exists but is not a Git repository: $target_path" >&2
  exit 1
else
  git clone -- "$repository_url" "$target_path"
fi

repository_root="$(git -C "$target_path" rev-parse --show-toplevel)"
origin_url="$(git -C "$repository_root" remote get-url origin)"

# The data repository holds real player evidence, so it must be private. This is
# checked here (setup time) and independently by the desktop app itself when Local
# Settings are saved (src/local/dataRepositoryVisibility.js) — the app never trusts
# that this script was run, or run correctly.
case "$origin_url" in
  'git@github.com:'*|'ssh://git@github.com/'*|'https://github.com/'*) ;;
  *)
    echo "Origin \"$origin_url\" is not a github.com owner/repo URL; cannot verify visibility." >&2
    exit 1
    ;;
esac
owner_repo="$(printf '%s' "$origin_url" \
  | sed -E \
    -e 's#^git@github\.com:##' \
    -e 's#^ssh://git@github\.com/##' \
    -e 's#^https://github\.com/##' \
    -e 's#\.git/?$##' \
    -e 's#/$##')"
# owner/repo is interpolated into the "repos/<owner>/<repo>" API path below, so accept
# only GitHub's own name charset and no relative segments that could re-point it.
if ! printf '%s' "$owner_repo" | grep -Eq '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$' \
  || printf '%s' "$owner_repo" | grep -Eq '(^|/)\.\.?($|/)'; then
  echo "Origin \"$origin_url\" is not a github.com owner/repo URL; cannot verify visibility." >&2
  exit 1
fi

# A single scalar line ("true|private") rather than an embedded JSON object: jq's
# pretty vs. compact object formatting is not guaranteed, but this is unambiguous to
# match with a plain case pattern.
visibility_summary="$(gh api "repos/$owner_repo" --jq '(.private | tostring) + "|" + .visibility')" \
  || {
    echo "Unable to look up \"$owner_repo\" via the GitHub CLI. Confirm \"gh auth status\" and that you have access." >&2
    exit 1
  }
case "$visibility_summary" in
  'true|private') ;;
  *)
    echo "Repository \"$owner_repo\" is not private (private|visibility: $visibility_summary). Use a private repository for player data." >&2
    exit 1
    ;;
esac

author_name="$(git -C "$repository_root" config --get user.name || true)"
author_email="$(git -C "$repository_root" config --get user.email || true)"
if [ -z "$author_name" ] || [ -z "$author_email" ]; then
  echo 'Configure git user.name and user.email before running this script.' >&2
  exit 1
fi
if [ "$author_name" = '.' ] || [ "$author_name" = '..' ] \
  || printf '%s' "$author_name" | grep -q '[<>:"/\\|?*]'; then
  echo 'git user.name cannot be used as a portable answer folder name.' >&2
  exit 1
fi

json_escape() {
  printf '%s' "$1" | sed 's/\\/\\\\/g; s/"/\\"/g'
}

escaped_root="$(json_escape "$repository_root")"
escaped_name="$(json_escape "$author_name")"
mkdir -p "$(dirname "$config_path")"
printf '{\n  "schemaVersion": 2,\n  "dataRepositoryPath": "%s",\n  "name": "%s"\n}\n' \
  "$escaped_root" "$escaped_name" > "$config_path"

printf 'Git: %s\n' "$(git --version)"
printf 'Repository: %s (private)\n' "$repository_root"
printf 'Name: %s\n' "$author_name"
printf 'Config: %s\n' "$config_path"
