#!/usr/bin/env sh
set -eu

repository_url="${1:-https://github.com/LUDIARS/VolputasData.git}"
target_path="${2:-$HOME/VolputasData}"
config_root="${XDG_CONFIG_HOME:-$HOME/.config}"
config_path="${3:-$config_root/Volputas/local-config.json}"

if ! command -v git >/dev/null 2>&1; then
  echo 'Git CLI was not found in PATH. Install Git and restart the terminal.' >&2
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
printf 'Repository: %s\n' "$repository_root"
printf 'Name: %s\n' "$author_name"
printf 'Config: %s\n' "$config_path"
